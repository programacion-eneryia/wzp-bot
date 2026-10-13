import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { safeWebhookUrlOrNull } from '../common/url-safety';

/** Datos para el webhook de salida "lead registrado" hacia GHL. */
export type PushLeadInput = {
  orgId: string;
  conversationId: string;
  contactId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
};

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

/**
 * Salida hacia GoHighLevel, sin dependencias de mensajería (la usan tanto el
 * intake de leads como el flujo de chat, sin ciclos de módulos):
 *
 *   - `pushLeadRegistered`: webhook "lead registrado" con el `setter_id`
 *     (UUID de la conversación) y el agente que atiende.
 *   - `syncChatLead`: cuando un lead entra por CHAT (no viene de GHL), crea o
 *     actualiza el contacto en GHL por API (busca por email/teléfono) para que
 *     allí puedan lanzarse seguimientos y agendas, y guarda su id.
 */
@Injectable()
export class GhlSyncService {
  private readonly logger = new Logger(GhlSyncService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Envía a GHL el webhook "lead registrado" con el setter_id. Idempotente:
   * solo se envía una vez por conversación (si el anterior falló, se reintenta).
   * Best-effort: nunca lanza.
   */
  async pushLeadRegistered(input: PushLeadInput): Promise<void> {
    try {
      const { data: integ } = await this.supabase.admin
        .from('integrations')
        .select('ghl_webhook_url')
        .eq('organization_id', input.orgId)
        .maybeSingle();
      // Revalidamos anti-SSRF antes de hacer la petición (defensa en profundidad).
      const url = safeWebhookUrlOrNull((integ?.ghl_webhook_url as string | null)?.trim());
      if (!url) return;

      const { data: existing } = await this.supabase.admin
        .from('outbound_events')
        .select('id, status')
        .eq('conversation_id', input.conversationId)
        .eq('kind', 'ghl_lead_registered')
        .maybeSingle();
      if (existing?.status === 'sent') return;

      const agent = await this.conversationAgent(input.orgId, input.conversationId);
      const payload = {
        event: 'lead_registered',
        setter_id: input.conversationId,
        ghl_contact_id: input.contactId ?? null,
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        source: input.source ?? null,
        agent_id: agent?.id ?? null,
        agent_name: agent?.name ?? null,
        status: 'new',
        sent_at: new Date().toISOString(),
      };

      let status = 'sent';
      const response: Record<string, unknown> = {};
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          // No seguir redirecciones: evita saltarse la validación anti-SSRF.
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        response.http_status = res.status;
        if (!res.ok) {
          status = 'failed';
          response.body = (await res.text().catch(() => '')).slice(0, 500);
        }
      } catch (err) {
        status = 'failed';
        response.error = String(err);
      }

      const row = {
        organization_id: input.orgId,
        conversation_id: input.conversationId,
        kind: 'ghl_lead_registered',
        target_url: url,
        status,
        request: payload,
        response,
      };
      if (existing) {
        await this.supabase.admin.from('outbound_events').update(row).eq('id', existing.id);
      } else {
        await this.supabase.admin.from('outbound_events').insert(row);
      }

      if (status === 'failed') {
        this.logger.warn(
          `Webhook de salida a GHL falló (conv ${input.conversationId}): ${JSON.stringify(response)}`,
        );
      } else {
        this.logger.log(`Enlazado con GHL: setter_id enviado (conv ${input.conversationId})`);
      }
    } catch (err) {
      this.logger.warn(`pushLeadRegistered error: ${String(err)}`);
    }
  }

  /**
   * Lead que entra por chat: crea/actualiza el contacto en GHL (si hay API
   * configurada) y envía el webhook "lead registrado". No hace nada si la
   * conversación ya viene enlazada con GHL. Best-effort: nunca lanza.
   */
  async syncChatLead(orgId: string, conversationId: string): Promise<void> {
    try {
      const { data: integ } = await this.supabase.admin
        .from('integrations')
        .select('ghl_api_token, ghl_location_id, ghl_setter_field, ghl_sync_chat_leads, ghl_webhook_url')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!integ || integ.ghl_sync_chat_leads === false) return;
      const token = this.crypto.decrypt(integ.ghl_api_token as string | null);
      const locationId = ((integ.ghl_location_id as string | null) ?? '').trim();
      if (!(token && locationId) && !integ.ghl_webhook_url) return;

      const { data: conv } = await this.supabase.admin
        .from('conversations')
        .select('id, contact_name, contact_handle, provider, ghl_contact_id, source')
        .eq('id', conversationId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!conv || conv.ghl_contact_id) return;

      const { data: lead } = await this.supabase.admin
        .from('leads')
        .select('id, email, phone, external_id')
        .eq('organization_id', orgId)
        .eq('conversation_id', conversationId)
        .maybeSingle();

      const phone = phoneFrom((lead?.phone as string | null) ?? (conv.contact_handle as string | null));
      const email = ((lead?.email as string | null) ?? '').trim().toLowerCase() || null;
      const name = ((conv.contact_name as string | null) ?? '').trim() || null;

      let contactId: string | null = null;
      if (token && locationId && (phone || email)) {
        contactId = await this.upsertContact(token, {
          locationId,
          name,
          phone,
          email,
          conversationId,
          provider: (conv.provider as string | null) ?? null,
          setterField: ((integ.ghl_setter_field as string | null) ?? '').trim() || null,
        });
        if (contactId) {
          await this.supabase.admin
            .from('conversations')
            .update({ ghl_contact_id: contactId })
            .eq('id', conversationId);
          if (lead && !lead.external_id) {
            await this.supabase.admin.from('leads').update({ external_id: contactId }).eq('id', lead.id);
          }
        }
      }

      await this.pushLeadRegistered({
        orgId,
        conversationId,
        contactId,
        name,
        phone,
        email,
        source: 'chat',
      });
    } catch (err) {
      this.logger.warn(`syncChatLead error (conv ${conversationId}): ${String(err)}`);
    }
  }

  /** POST /contacts/upsert: GHL crea o actualiza (dedupe por email/teléfono). */
  private async upsertContact(
    token: string,
    c: {
      locationId: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      conversationId: string;
      provider: string | null;
      setterField: string | null;
    },
  ): Promise<string | null> {
    const body: Record<string, unknown> = {
      locationId: c.locationId,
      source: 'Setter IA (chat)',
      tags: ['setter-ia', c.provider ? `setter-ia-${c.provider}` : null].filter(Boolean),
    };
    if (c.name) {
      body.name = c.name;
      const [first, ...rest] = c.name.split(/\s+/);
      body.firstName = first;
      if (rest.length) body.lastName = rest.join(' ');
    }
    if (c.phone) body.phone = c.phone;
    if (c.email) body.email = c.email;
    if (c.setterField) {
      // Admite el id del campo personalizado o su clave ("contact.setter_id").
      const looksLikeId = /^[A-Za-z0-9]{15,30}$/.test(c.setterField);
      body.customFields = [
        looksLikeId
          ? { id: c.setterField, field_value: c.conversationId }
          : { key: c.setterField.replace(/^contact\./, ''), field_value: c.conversationId },
      ];
    }

    try {
      const res = await fetch(`${GHL_API}/contacts/upsert`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          version: GHL_API_VERSION,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        this.logger.warn(
          `GHL upsert de contacto falló (${res.status}): ${JSON.stringify(json).slice(0, 300)}`,
        );
        return null;
      }
      const contact = (json.contact ?? {}) as Record<string, unknown>;
      const id = typeof contact.id === 'string' ? contact.id : null;
      this.logger.log(
        `Contacto ${json.new ? 'creado' : 'actualizado'} en GHL (${id ?? 'sin id'}) para conv ${c.conversationId}`,
      );
      return id;
    } catch (err) {
      this.logger.warn(`GHL upsert de contacto error: ${String(err)}`);
      return null;
    }
  }

  private async conversationAgent(
    orgId: string,
    conversationId: string,
  ): Promise<{ id: string; name: string } | null> {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('agent_id, channel_id')
      .eq('id', conversationId)
      .maybeSingle();
    let agentId = (conv?.agent_id as string | null) ?? null;
    if (!agentId && conv?.channel_id) {
      const { data: ch } = await this.supabase.admin
        .from('channels')
        .select('agent_id')
        .eq('id', conv.channel_id as string)
        .maybeSingle();
      agentId = (ch?.agent_id as string | null) ?? null;
    }
    let q = this.supabase.admin.from('agents').select('id, name').eq('organization_id', orgId);
    q = agentId ? q.eq('id', agentId) : q.eq('is_default_conversation', true);
    const { data } = await q.limit(1).maybeSingle();
    return data ? { id: data.id as string, name: data.name as string } : null;
  }
}

/** Teléfono en formato internacional (+dígitos) si el identificador lo es. */
function phoneFrom(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/@s\.whatsapp\.net$|@c\.us$/, '');
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length / s.replace(/\s/g, '').length < 0.7) return null;
  return `+${digits}`;
}
