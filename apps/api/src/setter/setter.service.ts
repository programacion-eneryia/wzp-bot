import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService, type ChatMessage } from '../openrouter/openrouter.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CalendarService } from '../calendar/calendar.service';
import { SetterConfigService } from './setter-config.service';
import {
  buildSystemPrompt,
  humanDelayMs,
  splitBubbles,
  stripEmojis,
  type ChatMode,
} from './prompt';

export type Bubble = { content: string; delayMs: number };

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
    private readonly config: ConfigService,
  ) {}

  /**
   * Genera la respuesta del setter para una conversación: lee la config del
   * negocio + el historial, llama al modelo, divide en burbujas humanas, las
   * persiste y las devuelve con sus retardos.
   */
  async respond(
    orgId: string,
    conversationId: string,
    mode: ChatMode = 'setter',
    opts: { contactName?: string | null; persist?: boolean } = {},
  ): Promise<Bubble[]> {
    const persist = opts.persist ?? true;
    const cfg = await this.setterConfig.getOrCreate(orgId);

    // Si el modo de agenda es "huecos", calculamos disponibilidad real para que
    // el bot ofrezca horas que de verdad están libres en el calendario.
    let availabilityText: string | null = null;
    if (mode === 'setter' && cfg.calendar_mode === 'slots' && cfg.default_calendar_id) {
      availabilityText = await this.calendar.getAvailabilityText(
        orgId,
        cfg.default_calendar_id,
        cfg.call_duration_min,
      );
    }

    const { data: history } = await this.supabase.admin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(cfg, mode, opts.contactName, availabilityText) },
      ...(history ?? [])
        .filter((m: StoredMessage) => m.role !== 'system')
        .map((m: StoredMessage): ChatMessage => ({
          role: m.role === 'contact' ? 'user' : 'assistant',
          content: m.content,
        })),
    ];

    const raw = await this.openrouter.chat(messages, {
      model: cfg.model ?? this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined,
    });

    const parts = cfg.multi_bubble
      ? splitBubbles(raw)
      : [stripEmojis(raw.trim())].filter((p) => p.length > 0);
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
