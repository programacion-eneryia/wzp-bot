import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MessagingService } from '../messaging/messaging.service';
import { StagesService } from '../stages/stages.service';
import { AgentsService } from '../agents/agents.service';
import { phoneVariants } from '../common/phone';

type MatchKeys = {
  setterId?: string;
  contactId?: string;
  phone?: string;
  email?: string;
};

/**
 * Sincronización con GoHighLevel (GHL).
 *
 *   - SALIDA: ver GhlSyncService (webhook "lead registrado" y contactos por API).
 *   - ENTRADA (paso 4): cuando el lead agenda (o cancela) en GHL, GHL nos avisa;
 *     registramos la cita y pausamos/reanudamos los seguimientos.
 */
@Injectable()
export class GhlService {
  private readonly logger = new Logger(GhlService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly messaging: MessagingService,
    private readonly stages: StagesService,
    private readonly agents: AgentsService,
  ) {}

  /** Resuelve la organización a partir del intake_token (endpoints públicos). */
  async resolveOrgByToken(token: string): Promise<string> {
    if (!token) throw new ForbiddenException('Falta el token de integración');
    const { data } = await this.supabase.admin
      .from('integrations')
      .select('organization_id')
      .eq('intake_token', token)
      .maybeSingle();
    if (!data) throw new ForbiddenException('Token de integración inválido');
    return data.organization_id as string;
  }

  // --- ENTRADA: paso 4 --------------------------------------------------------

  /**
   * Procesa el webhook de GHL cuando el lead agenda/reprograma/cancela una cita.
   * Correlaciona con la conversación por `setter_id` → `ghl_contact_id` →
   * teléfono/email, registra la cita y pausa (o reanuda) los seguimientos.
   */
  async handleAppointmentWebhook(
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; matched: boolean; action: string }> {
    const appt = (body.appointment ?? body.calendar ?? {}) as Record<string, unknown>;
    const contact = (body.contact ?? {}) as Record<string, unknown>;
    const customData = (body.customData ?? {}) as Record<string, unknown>;

    const rawAction = str(
      body.action ?? body.event ?? body.type ?? body.status ?? appt.status ?? body.appointmentStatus,
    );
    const action = normalizeAction(rawAction);

    const keys: MatchKeys = {
      setterId: str(body.setter_id ?? body.setterId ?? customData.setter_id ?? appt.setter_id),
      contactId: str(body.contact_id ?? body.contactId ?? contact.id ?? appt.contact_id),
      phone: digits(str(body.phone ?? contact.phone ?? appt.phone)),
      email: (str(body.email ?? contact.email ?? appt.email) || '').toLowerCase() || undefined,
    };
    const startAt = parseIso(
      body.start_time ?? body.startTime ?? body.start ?? appt.start_time ?? appt.startTime,
    );
    const endAt = parseIso(
      body.end_time ?? body.endTime ?? body.end ?? appt.end_time ?? appt.endTime,
    );
    const eventId = str(
      body.appointment_id ?? body.appointmentId ?? appt.id ?? body.id ?? body.event_id,
    );
    const meetUrl =
      str(body.meeting_url ?? appt.meeting_url ?? appt.address ?? appt.location) || null;

    // Salvaguarda anti "URL equivocada": este endpoint es SOLO para eventos de
    // cita. Si el payload no trae ninguna señal de cita (fecha/hora, id de cita,
    // objeto appointment/calendar) y no es una cancelación explícita, casi seguro
    // es un webhook de REGISTRO DE LEAD enviado por error a esta URL. No creamos
    // una cita fantasma: avisamos claramente para que se corrija la config en GHL.
    const hasAppointmentSignal =
      Boolean(startAt) ||
      Boolean(endAt) ||
      Boolean(eventId) ||
      Boolean(meetUrl) ||
      body.appointment != null ||
      body.calendar != null;
    if (action !== 'cancelled' && !hasAppointmentSignal) {
      this.logger.warn(
        `Webhook recibido en /webhooks/ghl/appointment SIN datos de cita (org ${orgId}). ` +
          `Parece un registro de lead enviado a la URL equivocada: usa la URL de ` +
          `"Entrada de leads" (/api/leads/intake?token=...) para registrar leads en el CRM.`,
      );
      return { ok: true, matched: false, action: 'ignored_not_appointment' };
    }

    const conv = await this.findConversation(orgId, keys);

    if (action === 'cancelled') {
      await this.recordCancellation(orgId, eventId, conv?.id ?? null);
      if (conv) {
        await this.supabase.admin
          .from('conversations')
          .update({ followups_paused: false, stage: conv.stage === 'won' ? 'won' : 'qualified' })
          .eq('id', conv.id)
          .eq('organization_id', orgId);
        await this.syncLeadStatus(orgId, conv.id, 'qualified');
      }
      this.logger.log(`Cita CANCELADA en GHL (org ${orgId}, conv ${conv?.id ?? 'n/d'})`);
      return { ok: true, matched: Boolean(conv), action };
    }

    // Agendado / reprogramado / confirmado → registrar cita y PAUSAR seguimientos.
    await this.upsertAppointment(orgId, {
      conversationId: conv?.id ?? null,
      eventId,
      startAt,
      endAt,
      meetUrl,
    });

    if (conv) {
      // Con la llamada ya agendada, el bot deja de hablar: pausamos también la
      // IA (no solo los seguimientos) para que no siga insistiendo al lead.
      await this.supabase.admin
        .from('conversations')
        .update({
          stage: conv.stage === 'won' ? 'won' : 'call_scheduled',
          followups_paused: true,
          ai_enabled: false,
          respond_after: null,
        })
        .eq('id', conv.id)
        .eq('organization_id', orgId);
      await this.syncLeadStatus(orgId, conv.id, 'call_scheduled');
      if (conv.stage !== 'won') {
        void this.stages.fireStageWorkflows(orgId, conv.id, 'call_scheduled');
      }
      this.logger.log(`Cita AGENDADA en GHL → IA y seguimientos pausados (conv ${conv.id})`);
    } else {
      this.logger.warn(
        `Cita de GHL sin conversación correlacionada (org ${orgId}, keys=${JSON.stringify(keys)})`,
      );
    }

    return { ok: true, matched: Boolean(conv), action };
  }

  /**
   * Webhook "control del bot" desde GHL: pausa o reactiva la IA de la
   * conversación del lead. Body esperado (flexible):
   *   { action: 'pause' | 'resume', setter_id | contact_id | phone | email }
   * Sin `action` (o no reconocida) se asume 'pause'.
   */
  async handleBotControlWebhook(
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; matched: boolean; action: string; agent?: string }> {
    const keys = extractMatchKeys(body);
    const rawAction = (
      str(body.action ?? body.event ?? body.type ?? body.bot ?? body.status) ?? ''
    ).toLowerCase();
    const action = /resume|reactivar|activar|activate|unpause|on|start/.test(rawAction)
      ? 'resume'
      : 'pause';

    const conv = await this.findConversation(orgId, keys);
    if (!conv) {
      this.logger.warn(
        `Webhook bot ${action} de GHL sin conversación (org ${orgId}, keys=${JSON.stringify(keys)})`,
      );
      return { ok: true, matched: false, action };
    }

    // Opcional: `agent` (id o nombre) → la conversación pasa a ese agente.
    const agentRef = extractAgentRef(body);
    let agentName: string | null = null;
    if (agentRef) {
      const agent = await this.agents.findActiveByRef(orgId, agentRef);
      if (agent) {
        await this.agents.setConversationAgent(orgId, conv.id, agent.id);
        agentName = agent.name;
      } else {
        this.logger.warn(`GHL pidió el agente "${agentRef}", que no existe o está inactivo (org ${orgId})`);
      }
    }

    // Al reactivar, si el contacto ya escribió y nadie le contestó, el bot le
    // responde en el próximo tick; si el último mensaje es nuestro, espera.
    let resume: Record<string, unknown> = { ai_enabled: true };
    if (action === 'resume') {
      const { data: last } = await this.supabase.admin
        .from('messages')
        .select('role')
        .eq('conversation_id', conv.id)
        .in('role', ['contact', 'assistant', 'agent'])
        .order('created_at', { ascending: false })
        .limit(1);
      resume = {
        ai_enabled: true,
        respond_after: last?.[0]?.role === 'contact' ? new Date().toISOString() : null,
      };
    }
    await this.supabase.admin
      .from('conversations')
      .update(action === 'resume' ? resume : { ai_enabled: false, respond_after: null })
      .eq('id', conv.id)
      .eq('organization_id', orgId);
    this.logger.log(
      `GHL → bot ${action === 'resume' ? 'REACTIVADO' : 'PAUSADO'} (conv ${conv.id}${agentName ? `, agente ${agentName}` : ''})`,
    );
    return { ok: true, matched: true, action, ...(agentName ? { agent: agentName } : {}) };
  }

  /**
   * Webhook "enviar mensaje" desde GHL: entrega al lead, por el canal del bot
   * (Unipile/Cloud), el texto que mande un flow de GHL. Es un envío
   * automático: NO pausa la IA.
   * Body esperado: { message | text, setter_id | contact_id | phone | email }.
   */
  async handleSendMessageWebhook(
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; matched: boolean }> {
    const customData = (body.customData ?? {}) as Record<string, unknown>;
    const message = str(
      body.message ?? body.text ?? body.body ?? customData.message ?? customData.text,
    );
    if (!message) {
      throw new BadRequestException(
        'Falta el texto: envía el campo "message" (o "text") en el body del webhook',
      );
    }

    const keys = extractMatchKeys(body);
    const conv = await this.findConversation(orgId, keys);
    if (!conv) {
      this.logger.warn(
        `Webhook send de GHL sin conversación (org ${orgId}, keys=${JSON.stringify(keys)})`,
      );
      return { ok: true, matched: false };
    }

    await this.messaging.sendAgentMessage(orgId, conv.id, message, { automated: 'ghl_workflow' });
    this.logger.log(`GHL → mensaje de flujo enviado al lead (conv ${conv.id})`);
    return { ok: true, matched: true };
  }

  // --- helpers ----------------------------------------------------------------

  /** Busca la conversación por setter_id → ghl_contact_id → teléfono → lead. */
  private async findConversation(
    orgId: string,
    keys: MatchKeys,
  ): Promise<{ id: string; stage: string } | null> {
    const sel = 'id, stage';

    if (keys.setterId && isUuid(keys.setterId)) {
      const { data } = await this.supabase.admin
        .from('conversations')
        .select(sel)
        .eq('organization_id', orgId)
        .eq('id', keys.setterId)
        .maybeSingle();
      if (data) return data as { id: string; stage: string };
    }

    // Si hubiera varias, preferimos la que tiene chat (donde escribe el contacto).
    const first = async (col: string, vals: string[]) => {
      const { data } = await this.supabase.admin
        .from('conversations')
        .select(sel)
        .eq('organization_id', orgId)
        .in(col, vals)
        .eq('is_test', false)
        .order('unipile_chat_id', { ascending: true, nullsFirst: false })
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1);
      return (data?.[0] as { id: string; stage: string } | undefined) ?? null;
    };

    if (keys.contactId) {
      const found = await first('ghl_contact_id', [keys.contactId]);
      if (found) return found;
    }

    // Teléfono en cualquiera de sus formas: GHL manda +52…, WhatsApp usa +521….
    if (keys.phone) {
      const found = await first('contact_handle', phoneVariants(`+${keys.phone}`));
      if (found) return found;
    }

    // Último recurso: por el lead del CRM (external_id/teléfono/email) → conv.
    const leadConvId = await this.findConversationViaLead(orgId, keys);
    if (leadConvId) {
      const { data } = await this.supabase.admin
        .from('conversations')
        .select(sel)
        .eq('organization_id', orgId)
        .eq('id', leadConvId)
        .maybeSingle();
      if (data) return data as { id: string; stage: string };
    }

    return null;
  }

  private async findConversationViaLead(
    orgId: string,
    keys: MatchKeys,
  ): Promise<string | null> {
    const pick = async (col: string, vals: string[]) => {
      const { data } = await this.supabase.admin
        .from('leads')
        .select('conversation_id')
        .eq('organization_id', orgId)
        .in(col, vals)
        .not('conversation_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1);
      return (data?.[0]?.conversation_id as string | null) ?? null;
    };
    if (keys.contactId) {
      const c = await pick('external_id', [keys.contactId]);
      if (c) return c;
    }
    if (keys.phone) {
      const c = await pick('phone', phoneVariants(`+${keys.phone}`));
      if (c) return c;
    }
    if (keys.email) {
      const c = await pick('email', [keys.email]);
      if (c) return c;
    }
    return null;
  }

  private async upsertAppointment(
    orgId: string,
    a: {
      conversationId: string | null;
      eventId?: string;
      startAt: string | null;
      endAt: string | null;
      meetUrl: string | null;
    },
  ): Promise<void> {
    const base = {
      organization_id: orgId,
      conversation_id: a.conversationId,
      start_at: a.startAt,
      end_at: a.endAt,
      meet_url: a.meetUrl,
      status: 'scheduled',
      detected_by: 'ghl',
      external_event_id: a.eventId ?? null,
      notes: 'Agendada en GoHighLevel',
    };

    if (a.eventId) {
      const { data: existing } = await this.supabase.admin
        .from('appointments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('external_event_id', a.eventId)
        .maybeSingle();
      if (existing) {
        await this.supabase.admin.from('appointments').update(base).eq('id', existing.id);
        return;
      }
    } else if (a.conversationId) {
      const { data: existing } = await this.supabase.admin
        .from('appointments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('conversation_id', a.conversationId)
        .eq('status', 'scheduled')
        .maybeSingle();
      if (existing) {
        await this.supabase.admin
          .from('appointments')
          .update({ start_at: a.startAt, end_at: a.endAt, meet_url: a.meetUrl })
          .eq('id', existing.id);
        return;
      }
    }
    await this.supabase.admin.from('appointments').insert(base);
  }

  private async recordCancellation(
    orgId: string,
    eventId: string | undefined,
    conversationId: string | null,
  ): Promise<void> {
    if (eventId) {
      await this.supabase.admin
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('organization_id', orgId)
        .eq('external_event_id', eventId);
      return;
    }
    if (conversationId) {
      await this.supabase.admin
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('organization_id', orgId)
        .eq('conversation_id', conversationId)
        .eq('status', 'scheduled');
    }
  }

  private async syncLeadStatus(orgId: string, conversationId: string, status: string): Promise<void> {
    await this.supabase.admin
      .from('leads')
      .update({ status })
      .eq('organization_id', orgId)
      .eq('conversation_id', conversationId);
  }
}

/** Claves de correlación comunes a todos los webhooks de GHL. */
function extractMatchKeys(body: Record<string, unknown>): MatchKeys {
  const contact = (body.contact ?? {}) as Record<string, unknown>;
  const customData = (body.customData ?? {}) as Record<string, unknown>;
  return {
    setterId: str(body.setter_id ?? body.setterId ?? customData.setter_id),
    contactId: str(body.contact_id ?? body.contactId ?? contact.id),
    phone: digits(str(body.phone ?? contact.phone ?? customData.phone)),
    email: (str(body.email ?? contact.email) || '').toLowerCase() || undefined,
  };
}

function extractAgentRef(body: Record<string, unknown>): string | undefined {
  const customData = (body.customData ?? {}) as Record<string, unknown>;
  return str(body.agent ?? body.agent_id ?? body.agent_name ?? customData.agent ?? customData.agent_id);
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function digits(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = v.replace(/[^\d]/g, '');
  return d.length >= 7 ? d : undefined;
}

function parseIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Normaliza el tipo de acción del webhook a: cancelled | booked. */
function normalizeAction(raw: string | undefined): 'cancelled' | 'booked' {
  const a = (raw ?? '').toLowerCase();
  if (/cancel|delete|remove|no.?show|noshow/.test(a)) return 'cancelled';
  return 'booked'; // booked | scheduled | confirmed | rescheduled | (por defecto)
}
