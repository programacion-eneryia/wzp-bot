import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService, type ChatMessage } from '../openrouter/openrouter.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CalendarService } from '../calendar/calendar.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { AgentsService } from '../agents/agents.service';
import type { Agent } from '../agents/agents.types';
import { StagesService } from '../stages/stages.service';
import { SetterConfigService } from './setter-config.service';
import {
  buildSystemPrompt,
  humanDelayMs,
  humanizePunctuation,
  splitBubbles,
  stripEmojis,
  stripInternalDirectives,
} from './prompt';

export type Bubble = { content: string; delayMs: number };

export type RespondOptions = {
  /** Agente ya resuelto por el llamador (evita resolverlo dos veces). */
  agent?: Agent | null;
  /** Forzar un agente concreto por id. */
  agentId?: string | null;
  contactName?: string | null;
  persist?: boolean;
};

type StoredMessage = {
  id: string;
  role: 'contact' | 'assistant' | 'agent' | 'system';
  content: string;
  created_at: string;
};

@Injectable()
export class SetterService {
  private readonly logger = new Logger(SetterService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openrouter: OpenRouterService,
    private readonly setterConfig: SetterConfigService,
    private readonly calendar: CalendarService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly config: ConfigService,
    private readonly agents: AgentsService,
    private readonly stages: StagesService,
  ) {}

  /**
   * Genera la respuesta del agente para una conversación: lee la Base de
   * Conocimiento del negocio + el agente que atiende + el historial, llama al
   * modelo, divide en burbujas humanas, las persiste y las devuelve con sus
   * retardos.
   */
  async respond(
    orgId: string,
    conversationId: string,
    opts: RespondOptions = {},
  ): Promise<Bubble[]> {
    const persist = opts.persist ?? true;
    const cfg = await this.setterConfig.getOrCreate(orgId);

    // Contexto que dejó el lead al registrarse (respuestas del formulario, incl.
    // la de cualificación), para que el bot adapte el trato desde el inicio.
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('lead_context, agent_id, channel_id, mode')
      .eq('id', conversationId)
      .maybeSingle();
    const leadContext = (conv?.lead_context as string | null) ?? null;

    // Qué agente atiende: el que nos pasan, el forzado por id o el resuelto por
    // conversación → canal → setter por defecto.
    const agent =
      opts.agent ??
      (opts.agentId
        ? await this.agents.get(orgId, opts.agentId)
        : await this.agents.resolveForConversation(orgId, {
            agent_id: (conv?.agent_id as string | null) ?? null,
            channel_id: (conv?.channel_id as string | null) ?? null,
            mode: (conv?.mode as string | null) ?? null,
          }));
    if (!agent) {
      this.logger.warn(`La org ${orgId} no tiene ningún agente activo; no se responde`);
      return [];
    }

    // Si el modo de agenda es "huecos", calculamos disponibilidad real para que
    // el bot ofrezca horas que de verdad están libres en el calendario.
    let availabilityText: string | null = null;
    if (agent.kind !== 'support' && agent.calendar_mode === 'slots' && agent.default_calendar_id) {
      availabilityText = await this.calendar.getAvailabilityText(
        orgId,
        agent.default_calendar_id,
        agent.call_duration_min,
      );
    }

    const stageNames = agent.uses_stages
      ? (await this.stages.list(orgId)).map((s) => s.name)
      : null;

    const { data: history } = await this.supabase.admin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    // Entrenamiento base común (definido por el super-admin) que hereda esta org.
    const globalBasePrompt = await this.platformSettings.getBasePrompt();

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(
          { business: cfg, agent, stageNames },
          opts.contactName,
          availabilityText,
          leadContext,
          globalBasePrompt,
        ),
      },
      ...(history ?? [])
        .filter((m: StoredMessage) => m.role !== 'system')
        .map((m: StoredMessage): ChatMessage => ({
          role: m.role === 'contact' ? 'user' : 'assistant',
          content: m.content,
        })),
    ];

    const raw = await this.openrouter.chat(messages, {
      model:
        agent.model ?? cfg.model ?? this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined,
      orgId,
      conversationId,
      purpose: 'respond',
    });

    const parts = cfg.multi_bubble
      ? splitBubbles(raw)
      : [humanizePunctuation(stripEmojis(stripInternalDirectives(raw.trim())))].filter(
          (p) => p.length > 0,
        );
    const bubbles: Bubble[] = parts.map((content) => ({
      content,
      delayMs: humanDelayMs(content, cfg.min_delay_ms, cfg.max_delay_ms),
    }));

    // Persistimos cada burbuja como un mensaje del asistente (salvo que el
    // llamador prefiera persistir él mismo según se vayan enviando).
    if (persist && bubbles.length > 0) {
      const rows = bubbles.map((b) => ({
        conversation_id: conversationId,
        organization_id: orgId,
        role: 'assistant' as const,
        content: b.content,
      }));
      const { error } = await this.supabase.admin.from('messages').insert(rows);
      if (error) this.logger.error(`No se pudieron guardar las respuestas: ${error.message}`);

      await this.supabase.admin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    return bubbles;
  }
}
