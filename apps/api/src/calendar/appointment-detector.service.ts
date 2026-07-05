import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { SupabaseService } from '../supabase/supabase.service';

type StoredMessage = { role: string; content: string; created_at: string };

// Señales baratas para no llamar al modelo en cada turno (ahorro de coste).
const SCHEDULING_HINTS =
  /\b(agend|reserv|cita|llamada|call|calendar|confirm|qued|nos vemos|disponib|hueco|horario|a las?\s*\d|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[ñn]ana|tarde|\d{1,2}[:h]\d{0,2})\b/i;

const SKIP_STAGES = new Set(['call_scheduled', 'won', 'lost', 'not_qualified']);

@Injectable()
export class AppointmentDetectorService {
  private readonly logger = new Logger(AppointmentDetectorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openrouter: OpenRouterService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Analiza el final de la conversación y, si detecta que el lead ha AGENDADO /
   * CONFIRMADO una llamada, marca la conversación como `call_scheduled` y crea la
   * cita. Pensado para llamarse tras cada respuesta del bot (fire-and-forget).
   */
  async maybeDetect(orgId: string, conversationId: string): Promise<void> {
    try {
      const { data: conv } = await this.supabase.admin
        .from('conversations')
        .select('id, stage, contact_handle')
        .eq('id', conversationId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!conv || SKIP_STAGES.has(conv.stage as string)) return;

      const { data: history } = await this.supabase.admin
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(14);
      const recent = ((history ?? []) as StoredMessage[]).reverse();
      if (recent.length === 0) return;

      // Pre-filtro barato: si no hay ninguna señal de agenda, no gastamos modelo.
      const blob = recent.map((m) => m.content).join(' ');
      if (!SCHEDULING_HINTS.test(blob)) return;

      const detection = await this.classify(recent, orgId, conversationId);
      if (!detection.booked || detection.confidence === 'baja') return;

      // Marca la conversación como "llamada agendada".
      await this.supabase.admin
        .from('conversations')
        .update({ stage: 'call_scheduled', last_message_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('organization_id', orgId);

      // Crea la cita si no existe ya una activa para esta conversación.
      const { data: existing } = await this.supabase.admin
        .from('appointments')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('status', 'scheduled')
        .maybeSingle();
      if (!existing) {
        const startAt = parseWhen(detection.datetime_iso);
        await this.supabase.admin.from('appointments').insert({
          organization_id: orgId,
          conversation_id: conversationId,
          start_at: startAt,
          status: 'scheduled',
          detected_by: 'bot',
          notes: detection.summary ?? null,
        });
      }

      this.logger.log(
        `Llamada agendada detectada por el bot (conv ${conversationId}, cuándo=${detection.datetime_iso ?? 'n/d'})`,
      );
    } catch (err) {
      this.logger.warn(`Detección de cita falló (conv ${conversationId}): ${String(err)}`);
    }
  }

  private async classify(
    messages: StoredMessage[],
    orgId: string,
    conversationId: string,
  ): Promise<{
    booked: boolean;
    datetime_iso: string | null;
    confidence: 'alta' | 'media' | 'baja';
    summary?: string;
  }> {
    const transcript = messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'contact' ? 'LEAD' : 'SETTER'}: ${m.content}`)
      .join('\n');

    const today = new Date().toISOString();
    const system = [
      'Eres un detector de citas. Lees el final de una conversación entre un setter',
      'y un lead, y decides si el lead ha AGENDADO o CONFIRMADO una llamada/cita.',
      `Hoy es ${today} (usa esto para resolver "mañana", "el martes", etc.).`,
      '',
      'Marca booked=true SOLO si hay confirmación real de una llamada/cita (el lead',
      'aceptó un hueco, confirmó una hora, o dijo que ya reservó por el enlace).',
      'NO marques booked=true por un simple interés o un "quizá".',
      '',
      'Devuelve EXCLUSIVAMENTE JSON válido con esta forma:',
      '{"booked": true|false, "datetime_iso": "ISO8601 o null", "confidence": "alta|media|baja", "summary": "frase corta"}',
    ].join('\n');

    const raw = await this.openrouter.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: transcript },
      ],
      {
        model: this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined,
        temperature: 0,
        maxTokens: 200,
        orgId,
        conversationId,
        purpose: 'detect',
      },
    );

    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      const obj = JSON.parse(json) as {
        booked?: boolean;
        datetime_iso?: string | null;
        confidence?: string;
        summary?: string;
      };
      return {
        booked: obj.booked === true,
        datetime_iso: obj.datetime_iso ?? null,
        confidence: (obj.confidence as 'alta' | 'media' | 'baja') ?? 'baja',
        summary: obj.summary,
      };
    } catch {
      return { booked: false, datetime_iso: null, confidence: 'baja' };
    }
  }
}

function parseWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
