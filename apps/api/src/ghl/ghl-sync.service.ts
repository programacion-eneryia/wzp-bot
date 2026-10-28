import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { safeWebhookUrlOrNull } from '../common/url-safety';
import { canonicalE164, phoneVariants } from '../common/phone';
import { GhlApi, type GhlContact } from './ghl-api';

/** Etiquetas y origen por defecto para los contactos que crea el bot. */
export const DEFAULT_GHL_CHAT_TAGS = ['setter-ia'];
export const DEFAULT_GHL_CHAT_SOURCE = 'Setter IA (chat)';

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
        .select(
          'ghl_api_token, ghl_location_id, ghl_setter_field, ghl_sync_chat_leads, ghl_webhook_url, ghl_chat_tags, ghl_chat_source',
        )
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

      // Al CRM siempre va el teléfono canónico E.164 (México +52…, nunca el
      // +521… de WhatsApp): así GHL encuentra el contacto del formulario.
      const phone =
        canonicalE164(lead?.phone as string | null) ?? canonicalE164(conv.contact_handle as string | null);
      const email = ((lead?.email as string | null) ?? '').trim().toLowerCase() || null;
      const name = ((conv.contact_name as string | null) ?? '').trim() || null;

      let contactId: string | null = (lead?.external_id as string | null) || null;
      if (token && locationId && (phone || email)) {
        const resolved = await this.resolveOrCreateContact(new GhlApi(token), {
          locationId,
          knownContactId: contactId,
          name,
          phone,
          email,
          conversationId,
          provider: (conv.provider as string | null) ?? null,
          setterField: ((integ.ghl_setter_field as string | null) ?? '').trim() || null,
          tags: normalizeTags(integ.ghl_chat_tags as string[] | null),
          source: ((integ.ghl_chat_source as string | null) ?? '').trim() || DEFAULT_GHL_CHAT_SOURCE,
        });
        if (resolved) {
          contactId = resolved;
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

  /**
   * Resuelve el contacto de GHL para un lead de chat y le añade lo del bot:
   *
   *   1. id ya conocido (lead/intake) →
   *   2. búsqueda en GHL por cualquier variante del teléfono (+52/+521, +54/+549,
   *      Brasil con/sin 9) y por email →
   *   3. solo si no existe ninguna, se CREA (teléfono canónico, nombre, origen
   *      y etiquetas configurados).
   *
   * En contactos existentes NO se toca nombre, teléfono, email ni origen: solo
   * se AÑADEN las etiquetas (POST /contacts/{id}/tags, nunca reemplaza) y se
   * rellena el campo `setter_id`. Devuelve el id o null si GHL no respondió.
   */
  private async resolveOrCreateContact(
    api: GhlApi,
    c: {
      locationId: string;
      knownContactId: string | null;
      name: string | null;
      phone: string | null;
      email: string | null;
      conversationId: string;
      provider: string | null;
      setterField: string | null;
      tags: string[];
      source: string;
    },
  ): Promise<string | null> {
    const tags = [...c.tags, c.provider ? `setter-ia-${c.provider}` : null].filter(Boolean) as string[];
    const customFields = c.setterField ? [setterFieldValue(c.setterField, c.conversationId)] : [];

    let existing: GhlContact | null = null;
    let how = 'id';
    if (c.knownContactId) existing = await api.getContact(c.knownContactId);
    if (!existing && c.phone) {
      how = 'teléfono';
      for (const variant of phoneVariants(c.phone).filter((v) => v.startsWith('+'))) {
        existing = await api.findDuplicate(c.locationId, { phone: variant });
        if (existing) break;
      }
    }
    if (!existing && c.email) {
      how = 'email';
      existing = await api.findDuplicate(c.locationId, { email: c.email });
    }

    if (existing) {
      // Solo lo nuestro: etiquetas (añadir) y setter_id. Nada más se pisa.
      await api.addTags(existing.id, tags);
      const patch: Record<string, unknown> = {};
      if (customFields.length) patch.customFields = customFields;
      // Rellenamos huecos, nunca sustituimos: teléfono/email solo si están vacíos.
      if (c.phone && !existing.phone) patch.phone = c.phone;
      if (c.email && !existing.email) patch.email = c.email;
      if (Object.keys(patch).length) await api.updateContact(existing.id, patch);
      this.logger.log(
        `Contacto de GHL encontrado por ${how} (${existing.id}) para conv ${c.conversationId}: etiquetas añadidas`,
      );
      return existing.id;
    }

    if (api.searchUnavailable) {
      // Sin permiso de lectura no podemos garantizar que no exista: usamos el
      // upsert de GHL (dedupe por teléfono/email) SIN campos que pisen nada.
      const body: Record<string, unknown> = { locationId: c.locationId };
      if (c.phone) body.phone = c.phone;
      if (c.email) body.email = c.email;
      if (customFields.length) body.customFields = customFields;
      const up = await api.upsertContact(body);
      if (!up) return null;
      if (up.isNew) await api.updateContact(up.id, { ...nameFields(c.name), source: c.source });
      await api.addTags(up.id, tags);
      this.logger.log(
        `Contacto ${up.isNew ? 'creado' : 'actualizado'} en GHL vía upsert (${up.id}) para conv ${c.conversationId}`,
      );
      return up.id;
    }

    const body: Record<string, unknown> = {
      locationId: c.locationId,
      source: c.source,
      tags,
      ...nameFields(c.name),
    };
    if (c.phone) body.phone = c.phone;
    if (c.email) body.email = c.email;
    if (customFields.length) body.customFields = customFields;
    const created = await api.createContact(body);
    if (!created) return null;
    if (created.duplicateOf) {
      // GHL detectó un duplicado que nuestra búsqueda no vio: lo reutilizamos.
      await api.addTags(created.duplicateOf, tags);
      if (customFields.length) await api.updateContact(created.duplicateOf, { customFields });
      this.logger.log(`GHL ya tenía el contacto (${created.duplicateOf}) para conv ${c.conversationId}`);
      return created.duplicateOf;
    }
    this.logger.log(`Contacto creado en GHL (${created.id}) para conv ${c.conversationId}`);
    return created.id;
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

/** Etiquetas configuradas (limpias, sin vacíos ni repetidas) o las de por defecto. */
export function normalizeTags(tags: string[] | null | undefined): string[] {
  const clean = (tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  return clean.length ? [...new Set(clean)] : [...DEFAULT_GHL_CHAT_TAGS];
}

/** Campo personalizado del setter_id: admite el id del campo o su clave ("contact.setter_id"). */
function setterFieldValue(field: string, value: string): Record<string, string> {
  const looksLikeId = /^[A-Za-z0-9]{15,30}$/.test(field);
  return looksLikeId ? { id: field, field_value: value } : { key: field.replace(/^contact\./, ''), field_value: value };
}

function nameFields(name: string | null): Record<string, string> {
  if (!name) return {};
  const [first, ...rest] = name.split(/\s+/);
  return { name, firstName: first, ...(rest.length ? { lastName: rest.join(' ') } : {}) };
}
