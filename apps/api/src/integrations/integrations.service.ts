import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { assertSafeWebhookUrl } from '../common/url-safety';

const COLS =
  'organization_id, intake_token, manychat_api_key, default_channel_id, proactive_enabled, ghl_webhook_url, ghl_api_token, ghl_location_id, ghl_setter_field, ghl_sync_chat_leads, ghl_chat_tags, ghl_chat_source';

export type Integration = {
  organization_id: string;
  intake_token: string;
  manychat_api_key: string | null;
  default_channel_id: string | null;
  proactive_enabled: boolean;
  ghl_webhook_url: string | null;
  /** Nunca se devuelve: solo si está configurado. */
  ghl_api_token?: string | null;
  ghl_api_token_set: boolean;
  ghl_location_id: string | null;
  ghl_setter_field: string | null;
  ghl_sync_chat_leads: boolean;
  /** Etiquetas que el bot AÑADE en GHL a los leads que entran por chat. */
  ghl_chat_tags: string[];
  /** Origen (source) solo para contactos que el bot CREA en GHL. */
  ghl_chat_source: string;
};

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  /** Descifra los secretos almacenados antes de devolver la fila. */
  private decode(row: Integration): Integration {
    const { ghl_api_token, ...rest } = row;
    return {
      ...rest,
      manychat_api_key: this.crypto.decrypt(row.manychat_api_key),
      ghl_api_token_set: Boolean(ghl_api_token),
    };
  }

  async getOrCreate(orgId: string): Promise<Integration> {
    const { data } = await this.supabase.admin
      .from('integrations')
      .select(COLS)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (data) return this.decode(data as Integration);

    const { data: created, error } = await this.supabase.admin
      .from('integrations')
      .insert({ organization_id: orgId })
      .select(COLS)
      .single();
    if (error) throw error;
    return this.decode(created as Integration);
  }

  async update(
    orgId: string,
    patch: {
      manychat_api_key?: string;
      default_channel_id?: string | null;
      proactive_enabled?: boolean;
      ghl_webhook_url?: string;
      ghl_api_token?: string;
      ghl_location_id?: string;
      ghl_setter_field?: string;
      ghl_sync_chat_leads?: boolean;
      ghl_chat_tags?: string[];
      ghl_chat_source?: string;
    },
  ): Promise<Integration> {
    await this.getOrCreate(orgId);
    const update: Record<string, unknown> = {};
    // Ciframos la API key en reposo (AES-256-GCM). Cadena vacía = borrar.
    if (typeof patch.manychat_api_key === 'string') {
      const v = patch.manychat_api_key.trim();
      update.manychat_api_key = v ? this.crypto.encrypt(v) : null;
    }
    if (patch.default_channel_id !== undefined) update.default_channel_id = patch.default_channel_id;
    if (typeof patch.proactive_enabled === 'boolean') update.proactive_enabled = patch.proactive_enabled;
    // URL del Inbound Webhook de GHL (destino de salida). Cadena vacía = borrar.
    // Validación anti-SSRF: exigimos https y bloqueamos hosts internos.
    if (typeof patch.ghl_webhook_url === 'string') {
      const v = patch.ghl_webhook_url.trim();
      update.ghl_webhook_url = v ? assertSafeWebhookUrl(v) : null;
    }
    // Token de la integración privada de GHL: cifrado en reposo. Vacío = borrar.
    if (typeof patch.ghl_api_token === 'string') {
      const v = patch.ghl_api_token.trim();
      update.ghl_api_token = v ? this.crypto.encrypt(v) : null;
    }
    if (typeof patch.ghl_location_id === 'string') {
      update.ghl_location_id = patch.ghl_location_id.trim() || null;
    }
    if (typeof patch.ghl_setter_field === 'string') {
      update.ghl_setter_field = patch.ghl_setter_field.trim() || null;
    }
    if (typeof patch.ghl_sync_chat_leads === 'boolean') {
      update.ghl_sync_chat_leads = patch.ghl_sync_chat_leads;
    }
    // Etiquetas limpias y sin repetir; lista vacía = las de por defecto.
    if (Array.isArray(patch.ghl_chat_tags)) {
      const tags = [...new Set(patch.ghl_chat_tags.map((t) => String(t).trim()).filter(Boolean))];
      update.ghl_chat_tags = tags.length ? tags.slice(0, 20) : ['setter-ia'];
    }
    if (typeof patch.ghl_chat_source === 'string') {
      update.ghl_chat_source = patch.ghl_chat_source.trim() || 'Setter IA (chat)';
    }

    const { data, error } = await this.supabase.admin
      .from('integrations')
      .update(update)
      .eq('organization_id', orgId)
      .select(COLS)
      .single();
    if (error) throw error;
    return this.decode(data as Integration);
  }

  async rotateToken(orgId: string): Promise<Integration> {
    await this.getOrCreate(orgId);
    const token = this.crypto.token(32); // 64 chars hex, criptográficamente seguro
    const { data, error } = await this.supabase.admin
      .from('integrations')
      .update({ intake_token: token })
      .eq('organization_id', orgId)
      .select(COLS)
      .single();
    if (error) throw error;
    return this.decode(data as Integration);
  }

  /** Devuelve las URLs listas para pegar en GHL/ManyChat/Zapier. */
  buildUrls(token: string) {
    const base = (this.config.get<string>('WEBHOOK_BASE_URL') ?? 'https://TU-DOMINIO').replace(/\/$/, '');
    return {
      lead_intake: `${base}/api/leads/intake?token=${token}`,
      ghl_lead: `${base}/api/leads/ghl?token=${token}`,
      ghl_appointment: `${base}/api/webhooks/ghl/appointment?token=${token}`,
      ghl_bot: `${base}/api/webhooks/ghl/bot?token=${token}`,
      ghl_send: `${base}/api/webhooks/ghl/send?token=${token}`,
      manychat_dynamic: `${base}/api/integrations/manychat/dynamic?token=${token}`,
    };
  }
}
