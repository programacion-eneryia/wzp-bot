import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Conversions API de Meta para "Business Messaging": al CUALIFICAR un lead que
 * vino de un anuncio click-to-WhatsApp, devolvemos a Meta el evento (con el
 * `ctwa_clid`) para que el anuncio optimice hacia leads de calidad.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/
 */
@Injectable()
export class ConversionsApiService {
  private readonly logger = new Logger(ConversionsApiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  private get version(): string {
    return this.config.get<string>('META_GRAPH_VERSION') ?? 'v23.0';
  }

  /**
   * Envía un evento (por defecto "Lead") atribuido al click del anuncio.
   * Idempotente por (conversación, evento) gracias al índice único en BD.
   */
  async sendConversion(params: {
    orgId: string;
    conversationId: string;
    ctwaClid: string;
    eventName?: string;
    phone?: string | null;
    value?: number;
    currency?: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    const token = this.config.get<string>('META_CAPI_TOKEN');
    if (!token) return { ok: false, reason: 'sin META_CAPI_TOKEN' };

    const { data: integ } = await this.supabase.admin
      .from('integrations')
      .select('meta_pixel_id')
      .eq('organization_id', params.orgId)
      .maybeSingle();
    const pixelId = integ?.meta_pixel_id as string | undefined;
    if (!pixelId) return { ok: false, reason: 'sin meta_pixel_id configurado' };

    const eventName = params.eventName ?? 'Lead';

    // No reenviar el mismo evento para la misma conversación.
    const { error: insErr } = await this.supabase.admin.from('meta_capi_events').insert({
      organization_id: params.orgId,
      conversation_id: params.conversationId,
      ctwa_clid: params.ctwaClid,
      event_name: eventName,
      status: 'sent',
    });
    if (insErr) {
      // Violación de unicidad => ya se envió.
      return { ok: false, reason: 'ya enviado' };
    }

    const userData: Record<string, unknown> = { ctwa_clid: params.ctwaClid };
    if (params.phone) userData.ph = [sha256(normalizePhone(params.phone))];

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          user_data: userData,
          ...(params.value != null
            ? { custom_data: { currency: params.currency ?? 'EUR', value: params.value } }
            : {}),
        },
      ],
    };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${this.version}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await this.markFailed(params.conversationId, eventName, json);
        return { ok: false, reason: `Meta ${res.status}` };
      }
      await this.supabase.admin
        .from('meta_capi_events')
        .update({ response: json })
        .eq('conversation_id', params.conversationId)
        .eq('event_name', eventName);
      this.logger.log(`CAPI ${eventName} enviado (conv ${params.conversationId})`);
      return { ok: true };
    } catch (err) {
      await this.markFailed(params.conversationId, eventName, { error: String(err) });
      return { ok: false, reason: String(err) };
    }
  }

  private async markFailed(conversationId: string, eventName: string, response: unknown) {
    await this.supabase.admin
      .from('meta_capi_events')
      .update({ status: 'failed', response })
      .eq('conversation_id', conversationId)
      .eq('event_name', eventName);
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}
