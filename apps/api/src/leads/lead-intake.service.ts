import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SetterConfigService } from '../setter/setter-config.service';
import { MessagingService } from '../messaging/messaging.service';

export type IntakeInput = {
  /** Token de la org (intake_token de la tabla integrations). */
  token: string;
  name?: string;
  phone?: string;
  email?: string;
  /** Canal por el que contactar (por defecto whatsapp). */
  channel?: 'whatsapp' | 'instagram' | 'messenger';
  /** De dónde viene el lead. */
  source?: string;
  source_detail?: string;
  campaign?: string;
  /** Primer mensaje del lead, si lo hay (p.ej. comentario de IG). */
  message?: string;
  /** Id del contacto en el sistema externo (ManyChat subscriber, etc.). */
  external_id?: string;
  /** Si false, no se envía el primer mensaje proactivo (solo se registra). */
  proactive?: boolean;
};

export type IntakeResult = {
  conversationId: string;
  proactiveSent: boolean;
  reason?: string;
};

@Injectable()
export class LeadIntakeService {
  private readonly logger = new Logger(LeadIntakeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly setterConfig: SetterConfigService,
    private readonly messaging: MessagingService,
  ) {}

  /** Resuelve la organización a partir del token de intake. */
  private async resolveOrg(token: string) {
    if (!token) throw new ForbiddenException('Falta el token de integración');
    const { data } = await this.supabase.admin
      .from('integrations')
      .select('organization_id, default_channel_id, proactive_enabled')
      .eq('intake_token', token)
      .maybeSingle();
    if (!data) throw new ForbiddenException('Token de integración inválido');
    return data as {
      organization_id: string;
      default_channel_id: string | null;
      proactive_enabled: boolean;
    };
  }

  /** Elige el canal a usar: el por defecto de la org, o el primero del proveedor. */
  private async pickChannel(orgId: string, defaultChannelId: string | null, provider: string) {
    if (defaultChannelId) {
      const { data } = await this.supabase.admin
        .from('channels')
        .select('id, provider, unipile_account_id, status')
        .eq('id', defaultChannelId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (data) return data;
    }
    const { data } = await this.supabase.admin
      .from('channels')
      .select('id, provider, unipile_account_id, status')
      .eq('organization_id', orgId)
      .eq('provider', provider)
      .limit(1)
      .maybeSingle();
    return data;
  }

  async intake(input: IntakeInput): Promise<IntakeResult> {
    const org = await this.resolveOrg(input.token);
    const orgId = org.organization_id;
    const provider = input.channel ?? 'whatsapp';

    const phoneDigits = normalizePhone(input.phone);
    if (provider === 'whatsapp' && !phoneDigits && !input.external_id) {
      throw new ForbiddenException('Falta el teléfono del lead');
    }

    const channel = await this.pickChannel(orgId, org.default_channel_id, provider);
    if (!channel) {
      throw new ForbiddenException(`No hay canal de ${provider} conectado en esta cuenta`);
    }

    // Buscamos conversación existente por teléfono/subscriber para no duplicar.
    const conv = await this.findOrCreateConversation(orgId, channel, provider, phoneDigits, input);

    const wantsProactive = (input.proactive ?? true) && org.proactive_enabled;
    if (!wantsProactive) {
      return { conversationId: conv.id, proactiveSent: false, reason: 'proactivo desactivado' };
    }
    if (conv.proactive_sent) {
      return { conversationId: conv.id, proactiveSent: false, reason: 'ya se contactó antes' };
    }

    // Por ahora el primer mensaje proactivo solo está soportado en WhatsApp
    // (en IG/Messenger la ventana de 24h obliga a pasar por ManyChat).
    if (provider !== 'whatsapp') {
      return { conversationId: conv.id, proactiveSent: false, reason: 'proactivo solo en WhatsApp' };
    }

    const cfg = await this.setterConfig.getOrCreate(orgId);
    const template = (cfg.proactive_template ?? '').trim();
    if (!template) {
      return {
        conversationId: conv.id,
        proactiveSent: false,
        reason: 'no hay plantilla proactiva configurada',
      };
    }
    if (!cfg.is_active) {
      return { conversationId: conv.id, proactiveSent: false, reason: 'IA desactivada globalmente' };
    }

    const text = renderTemplate(template, { name: input.name ?? '' });

    // El envío real lo hace la cola con throttling (espaciado + horario activo),
    // para proteger el número de WhatsApp.
    const { delayMs } = await this.messaging.enqueueProactive({
      orgId,
      conversationId: conv.id,
      accountId: channel.unipile_account_id as string,
      attendeeId: phoneDigits as string,
      content: text,
    });

    this.logger.log(
      `Lead encolado para contacto proactivo (conv ${conv.id}, source=${input.source ?? 'n/d'}, en ~${Math.round(delayMs / 1000)}s)`,
    );
    return {
      conversationId: conv.id,
      proactiveSent: true,
      reason: delayMs > 1000 ? `programado en ~${Math.round(delayMs / 1000)}s` : undefined,
    };
  }

  private async findOrCreateConversation(
    orgId: string,
    channel: { id: string; provider: string },
    provider: string,
    phoneDigits: string | null,
    input: IntakeInput,
  ): Promise<{
    id: string;
    proactive_sent: boolean;
    unipile_chat_id: string | null;
    contact_external_id: string | null;
  }> {
    const handle = phoneDigits ? `+${phoneDigits}` : null;

    // 1) Por subscriber externo (ManyChat, etc.)
    if (input.external_id) {
      const { data } = await this.supabase.admin
        .from('conversations')
        .select('id, proactive_sent, unipile_chat_id, contact_external_id')
        .eq('organization_id', orgId)
        .eq('external_subscriber_id', input.external_id)
        .eq('is_test', false)
        .maybeSingle();
      if (data) return data;
    }

    // 2) Por teléfono (handle) en el mismo canal.
    if (handle) {
      const { data } = await this.supabase.admin
        .from('conversations')
        .select('id, proactive_sent, unipile_chat_id, contact_external_id')
        .eq('organization_id', orgId)
        .eq('channel_id', channel.id)
        .eq('contact_handle', handle)
        .eq('is_test', false)
        .maybeSingle();
      if (data) {
        // Actualizamos origen/consentimiento por si llega más info.
        await this.supabase.admin
          .from('conversations')
          .update({
            source: input.source ?? null,
            source_detail: input.source_detail ?? null,
            campaign: input.campaign ?? null,
            consent_optin: true,
            mode: 'setter',
            ai_enabled: true,
          })
          .eq('id', data.id);
        return data;
      }
    }

    const { data: created, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        organization_id: orgId,
        channel_id: channel.id,
        provider,
        contact_name: input.name ?? 'Lead',
        contact_handle: handle,
        external_subscriber_id: input.external_id ?? null,
        source: input.source ?? null,
        source_detail: input.source_detail ?? null,
        campaign: input.campaign ?? null,
        consent_optin: true,
        // Origen de campaña/lead → siempre setter, y fijado (no reclasificar).
        mode: 'setter',
        mode_locked: true,
        ai_enabled: true,
        is_test: false,
        stage: 'new',
      })
      .select('id, proactive_sent, unipile_chat_id, contact_external_id')
      .single();
    if (error) throw error;
    return created;
  }
}

/** Deja solo dígitos (formato internacional sin +). */
function normalizePhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 ? digits : null;
}

/** Sustituye variables tipo {nombre}/{name} en la plantilla. */
function renderTemplate(tpl: string, vars: { name: string }): string {
  const first = (vars.name || '').trim().split(/\s+/)[0] ?? '';
  return tpl
    .replace(/\{\s*(nombre|name|first_name)\s*\}/gi, first)
    .replace(/\{\s*(nombre_completo|full_name)\s*\}/gi, vars.name.trim())
    .trim();
}
