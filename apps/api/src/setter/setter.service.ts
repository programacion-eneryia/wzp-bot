import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService, type ChatMessage } from '../openrouter/openrouter.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CalendarService } from '../calendar/calendar.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { AgentsService } from '../agents/agents.service';
import { effectiveBehavior, type Agent } from '../agents/agents.types';
import { StagesService } from '../stages/stages.service';
import { SetterConfigService } from './setter-config.service';
import {
  RESUME_DIRECTIVE_RE,
  extractResumeDirective,
  formatDateTimeEs,
  formatShortEs,
  safeTz,
  timezoneForPhone,
} from '../common/time';
import {
  BUBBLE_SEPARATOR,
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
    const ctx = await this.buildContext(orgId, conversationId, opts);
    if (!ctx) return [];
    const { cfg, agent, messages, timezone } = ctx;

    const rawModel = await this.openrouter.chat(messages, {
      model: this.modelFor(agent, cfg),
      orgId,
      conversationId,
      purpose: 'respond',
    });

    // La persona pidió hablar más tarde: el modelo lo marca y el sistema
    // retoma la conversación a esa hora (sin seguimientos antes).
    const { text: raw, resumeAt } = extractResumeDirective(rawModel, timezone);
    if (resumeAt) {
      await this.supabase.admin
        .from('conversations')
        .update({ resume_at: resumeAt.toISOString() })
        .eq('id', conversationId);
      this.logger.log(`Conversación ${conversationId}: retomar el ${resumeAt.toISOString()} (${timezone})`);
    } else if (RESUME_DIRECTIVE_RE.test(rawModel)) {
      this.logger.warn(`Conversación ${conversationId}: marca RETOMAR inválida ignorada`);
    }

    const bubbles = this.toBubbles(raw, cfg, agent);

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

  /**
   * Genera un SEGUIMIENTO: el lead no ha contestado al último mensaje del bot.
   * Devuelve [] si el modelo decide que no procede insistir (el lead se despidió,
   * dijo que no, ya está agendado…).
   */
  async followUp(
    orgId: string,
    conversationId: string,
    opts: RespondOptions & {
      step: number;
      total: number;
      silentMinutes: number;
      /** Textos de los seguimientos ya enviados en esta racha de silencio. */
      previous?: string[];
      /** La persona pidió que le escribiéramos más tarde y ya es el momento. */
      resume?: boolean;
    },
  ): Promise<Bubble[]> {
    const ctx = await this.buildContext(orgId, conversationId, opts);
    if (!ctx) return [];
    const { cfg, agent, messages, nowText } = ctx;

    if (opts.resume) {
      messages.push({
        role: 'user',
        content:
          `[INSTRUCCIÓN DEL SISTEMA — RETOMAR LA CONVERSACIÓN. Este texto NO lo ha escrito la persona.]\n` +
          `La persona te pidió que le escribieras más tarde y quedaste en hacerlo. Ya es el momento acordado (ahora es ${nowText}).\n` +
          `- Escribe un mensaje breve y natural retomando donde lo dejasteis, como quien cumple lo prometido ("buenas, ¿qué tal? ya con más calma, te cuento…"). Sin reproches, sin decir cuánto tiempo ha pasado y sin repetir lo ya dicho.\n` +
          `- Si tenía pendiente ver algo (un vídeo, un enlace), pregúntale si pudo verlo; si quedó una pregunta en el aire, retómala de forma ligera.\n` +
          `- Muy breve: una o dos frases, una sola burbuja salvo que sea imprescindible.\n` +
          `- Si en el historial la persona ya se despidió del todo, dijo que no le interesa o pidió que no le escribas, responde EXACTAMENTE: NO_SEGUIMIENTO`,
      });
      const rawResume = await this.openrouter.chat(messages, {
        model: this.modelFor(agent, cfg),
        orgId,
        conversationId,
        purpose: 'followup',
        temperature: 0.7,
      });
      if (/NO_SEGUIMIENTO/i.test(rawResume) || !rawResume.trim()) return [];
      return this.toBubbles(extractResumeDirective(rawResume, ctx.timezone).text, cfg, agent).slice(0, 2);
    }

    const n = opts.step + 1;
    const last = n >= opts.total;
    const silence =
      opts.silentMinutes >= 2880
        ? `${Math.round(opts.silentMinutes / 1440)} días`
        : opts.silentMinutes >= 120
          ? `${Math.round(opts.silentMinutes / 60)} horas`
          : `${opts.silentMinutes} minutos`;

    const previous = (opts.previous ?? []).map((t) => t.trim()).filter(Boolean);
    const previousBlock = previous.length
      ? `\nYA LE HAS ENVIADO ESTOS MENSAJES SIN RESPUESTA (PROHIBIDO repetirlos, parafrasearlos o volver a preguntar lo mismo con otras palabras):\n` +
        previous.map((t) => `  · "${t}"`).join('\n') +
        `\n`
      : '';

    // Va como turno de usuario (no de sistema): Claude exige que la conversación
    // termine en un mensaje del usuario y aquí el último turno real es del bot.
    messages.push({
      role: 'user',
      content:
        `[INSTRUCCIÓN DEL SISTEMA — SEGUIMIENTO AUTOMÁTICO. Este texto NO lo ha escrito el lead; el lead no ha dicho nada.]\n` +
        `El lead lleva ${silence} sin contestar. Escribe ahora el seguimiento ${n} de ${opts.total}` +
        (last ? ' (el ÚLTIMO)' : '') +
        `.\n` +
        previousBlock +
        (n === 1
          ? `- Retoma de forma natural lo que quedó pendiente, pero desde otro ángulo: si le pasaste un vídeo o enlace, pregúntale qué le pareció; si le hiciste una pregunta, NO la repitas: dale un motivo breve para contestar o pregúntale otra cosa relacionada. Tono ligero, como quien escribe de pasada.\n`
          : last
            ? `- Es el último intento: cierra con elegancia dejando la puerta abierta (que te escriba cuando le encaje), sin reproches ni presión. Ángulo distinto a todo lo anterior.\n`
            : `- Cambia de ángulo respecto a los seguimientos anteriores: aporta algo nuevo (un dato útil, un beneficio concreto, una objeción típica resuelta en una frase o una pregunta distinta). No vuelvas a preguntar si vio algo si ya se lo preguntaste.\n`) +
        `- Muy breve: una o dos frases, una sola burbuja salvo que sea imprescindible. Sin saludos largos ni repetir lo ya dicho.\n` +
        `- Si en la conversación el lead ya se despidió, dijo claramente que no le interesa, pidió que no le escribas, ya agendó, le dijiste que no encajaba y se cerró la conversación, o insistir sería inoportuno, responde EXACTAMENTE: NO_SEGUIMIENTO`,
    });

    const raw = await this.openrouter.chat(messages, {
      model: this.modelFor(agent, cfg),
      orgId,
      conversationId,
      purpose: 'followup',
      temperature: 0.7,
    });
    if (/NO_SEGUIMIENTO/i.test(raw) || !raw.trim()) return [];

    // Como mucho dos burbujas: un seguimiento no es una parrafada.
    return this.toBubbles(raw, cfg, agent).slice(0, 2);
  }

  private modelFor(agent: Agent, cfg: { model: string | null }): string | undefined {
    return (
      agent.model ?? cfg.model ?? this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined
    );
  }

  private toBubbles(raw: string, cfg: Parameters<typeof effectiveBehavior>[0], agent: Agent): Bubble[] {
    const behavior = effectiveBehavior(cfg, agent) as {
      multi_bubble: boolean;
      min_delay_ms: number;
      max_delay_ms: number;
    };
    // En modo "un solo mensaje" el separador de burbujas no debe llegar al
    // lead: las partes se juntan en un único texto (ocurrió en producción).
    const parts = behavior.multi_bubble
      ? splitBubbles(raw)
      : [
          humanizePunctuation(
            stripEmojis(
              stripInternalDirectives(
                raw
                  .split(BUBBLE_SEPARATOR)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .join('\n'),
              ),
            ),
          ),
        ].filter((p) => p.length > 0);
    return parts.map((content) => ({
      content,
      delayMs: humanDelayMs(content, behavior.min_delay_ms, behavior.max_delay_ms),
    }));
  }

  /** Base de Conocimiento + agente + historial → mensajes para el modelo. */
  private async buildContext(orgId: string, conversationId: string, opts: RespondOptions) {
    const cfg = await this.setterConfig.getOrCreate(orgId);

    // Contexto que dejó el lead al registrarse (respuestas del formulario, incl.
    // la de cualificación), para que el bot adapte el trato desde el inicio.
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('lead_context, agent_id, channel_id, mode, contact_handle')
      .eq('id', conversationId)
      .maybeSingle();
    const leadContext = (conv?.lead_context as string | null) ?? null;

    // Reloj para el modelo, en la hora de la persona (por el prefijo de su
    // teléfono; si no se reconoce, la del negocio).
    const timezone = safeTz(
      timezoneForPhone(conv?.contact_handle as string | null) ?? cfg.timezone,
    );
    const nowMs = Date.now();
    const nowText = formatDateTimeEs(nowMs, timezone);

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
      return null;
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

    // Solo las etapas del pipeline del agente.
    const stageNames = agent.pipeline_id
      ? (await this.stages.list(orgId))
          .filter((s) => s.pipeline_id === agent.pipeline_id)
          .map((s) => s.name)
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
          // El formato de salida (burbujas o un solo mensaje) debe ser el mismo
          // que luego aplica toBubbles: el del agente si tiene ajustes propios.
          { business: effectiveBehavior(cfg, agent), agent, stageNames, now: { text: nowText, timezone } },
          opts.contactName,
          availabilityText,
          leadContext,
          globalBasePrompt,
        ),
      },
      // Cada mensaje lleva su fecha/hora: así el modelo sabe cuánto tiempo ha
      // pasado y no confunde "mañana" con "dentro de diez minutos".
      ...(history ?? [])
        .filter((m: StoredMessage) => m.role !== 'system')
        .map((m: StoredMessage): ChatMessage => {
          const at = Date.parse(m.created_at);
          const stamp = Number.isFinite(at) ? `[${formatShortEs(at, timezone)}] ` : '';
          return {
            role: m.role === 'contact' ? 'user' : 'assistant',
            content: `${stamp}${m.content}`,
          };
        }),
    ];

    return { cfg, agent, messages, timezone, nowText };
  }
}
