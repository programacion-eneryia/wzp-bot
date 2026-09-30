import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Citas (llamadas agendadas). Se crean por dos vías:
 *   - El BOT al detectar el agendamiento en el chat (AppointmentDetectorService).
 *   - El webhook del calendario (ground-truth) cuando se crea/cancela un evento.
 */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string) {
    const { data, error } = await this.supabase.admin
      .from('appointments')
      .select('id, conversation_id, start_at, end_at, status, detected_by, meet_url, notes, created_at')
      .eq('organization_id', orgId)
      .order('start_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    const appts = data ?? [];

    // Nombre y teléfono de quien agendó: viven en la conversación vinculada.
    const convIds = [...new Set(appts.map((a) => a.conversation_id as string).filter(Boolean))];
    if (convIds.length === 0) return appts;
    const { data: convs } = await this.supabase.admin
      .from('conversations')
      .select('id, contact_name, contact_handle')
      .in('id', convIds);
    const byId = new Map((convs ?? []).map((c) => [c.id as string, c]));
    return appts.map((a) => {
      const conv = byId.get(a.conversation_id as string);
      return {
        ...a,
        contact_name: (conv?.contact_name as string) ?? null,
        contact_handle: (conv?.contact_handle as string) ?? null,
      };
    });
  }

  /**
   * Webhook de calendario de Unipile (evento creado/actualizado/borrado).
   * Best-effort: vincula el evento a una conversación por el teléfono/email del
   * asistente y, si procede, marca la conversación como `call_scheduled`.
   */
  async handleEventWebhook(payload: Record<string, unknown>): Promise<void> {
    try {
      const accountId = str(payload.account_id);
      const eventId = str(payload.event_id ?? (payload.event as Record<string, unknown>)?.id);
      const action = str(payload.action ?? payload.event_type ?? payload.status).toLowerCase();
      if (!accountId) return;

      const { data: cal } = await this.supabase.admin
        .from('calendars')
        .select('id, organization_id')
        .eq('unipile_account_id', accountId)
        .maybeSingle();
      if (!cal) return;
      const orgId = cal.organization_id as string;

      // Cancelación: marca la cita como cancelada si la conocíamos.
      if (eventId && /cancel|delete|remove/.test(action)) {
        await this.supabase.admin
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('unipile_event_id', eventId)
          .eq('organization_id', orgId);
        return;
      }

      const ev = (payload.event as Record<string, unknown>) ?? payload;
      const startAt = parseIso(ev.start);
      const endAt = parseIso(ev.end);
      const meetUrl = str(ev.meeting_url ?? (ev.conferencing as Record<string, unknown>)?.url) || null;

      // Intentamos vincular a una conversación por el teléfono del asistente.
      const phones = extractAttendeePhones(ev);
      let conversationId: string | null = null;
      for (const phone of phones) {
        const { data: conv } = await this.supabase.admin
          .from('conversations')
          .select('id')
          .eq('organization_id', orgId)
          .or(`contact_handle.eq.+${phone},contact_external_id.eq.${phone}`)
          .maybeSingle();
        if (conv) {
          conversationId = conv.id as string;
          break;
        }
      }

      if (eventId) {
        const { data: existing } = await this.supabase.admin
          .from('appointments')
          .select('id')
          .eq('unipile_event_id', eventId)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (existing) {
          await this.supabase.admin
            .from('appointments')
            .update({ start_at: startAt, end_at: endAt, meet_url: meetUrl, status: 'scheduled' })
            .eq('id', existing.id);
        } else {
          await this.supabase.admin.from('appointments').insert({
            organization_id: orgId,
            calendar_id: cal.id,
            conversation_id: conversationId,
            start_at: startAt,
            end_at: endAt,
            meet_url: meetUrl,
            unipile_event_id: eventId,
            status: 'scheduled',
            detected_by: 'calendar',
          });
        }
      }

      if (conversationId) {
        // Cita confirmada en el calendario (ground-truth): el bot deja de
        // hablar con este lead hasta que un humano o un flow lo reactive.
        await this.supabase.admin
          .from('conversations')
          .update({
            stage: 'call_scheduled',
            ai_enabled: false,
            respond_after: null,
            followups_paused: true,
          })
          .eq('id', conversationId)
          .eq('organization_id', orgId)
          .neq('stage', 'won');
      }
    } catch (err) {
      this.logger.warn(`Webhook de calendario falló: ${String(err)}`);
    }
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function parseIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractAttendeePhones(ev: Record<string, unknown>): string[] {
  const out: string[] = [];
  const attendees = ev.attendees;
  if (Array.isArray(attendees)) {
    for (const a of attendees) {
      const phone = str((a as Record<string, unknown>)?.phone).replace(/[^\d]/g, '');
      if (phone.length >= 7) out.push(phone);
    }
  }
  const desc = str(ev.description);
  const m = desc.match(/\+?\d[\d\s]{7,}\d/g);
  if (m) out.push(...m.map((p) => p.replace(/[^\d]/g, '')));
  return [...new Set(out)];
}
