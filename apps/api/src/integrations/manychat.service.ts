import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { SetterService } from '../setter/setter.service';

/** Respuesta en el formato Dynamic Block v2 que ManyChat renderiza y envía. */
type ManyChatResponse = {
  version: 'v2';
  content: {
    type: 'instagram';
    messages: { type: 'text'; text: string }[];
    actions: unknown[];
    quick_replies: unknown[];
    /** Hace que el SIGUIENTE mensaje del contacto vuelva a llamarnos. */
    external_message_callback?: {
      url: string;
      method: 'post';
      payload: Record<string, unknown>;
      timeout: number;
    };
  };
};

@Injectable()
export class ManyChatService {
  private readonly logger = new Logger(ManyChatService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly setter: SetterService,
    private readonly config: ConfigService,
  ) {}

  private async resolveOrgId(token: string): Promise<string> {
    if (!token) throw new ForbiddenException('Falta el token de integración');
    const { data } = await this.supabase.admin
      .from('integrations')
      .select('organization_id')
      .eq('intake_token', token)
      .maybeSingle();
    if (!data) throw new ForbiddenException('Token de integración inválido');
    return data.organization_id as string;
  }

  /**
   * Punto de entrada del Dynamic Block de ManyChat: recibe el mensaje del
   * contacto en Instagram, genera la respuesta con la IA (modo setter, porque
   * IG = origen de campaña) y la devuelve en el formato que ManyChat enviará.
   */
  async handleDynamic(
    token: string,
    body: Record<string, unknown>,
  ): Promise<ManyChatResponse> {
    const orgId = await this.resolveOrgId(token);

    const subscriberId = str(body.subscriber_id ?? body.id ?? body.user_id);
    const name = str(body.name ?? body.first_name);
    const text = str(body.last_input_text ?? body.text ?? body.message);

    if (!subscriberId) {
      return this.reply(token, ['perdona, no te he podido leer bien, me lo repites?']);
    }

    const convId = await this.upsertConversation(orgId, subscriberId, name);

    if (text) {
      await this.supabase.admin.from('messages').insert({
        conversation_id: convId,
        organization_id: orgId,
        role: 'contact',
        content: text,
      });
      await this.supabase.admin
        .from('conversations')
        .update({
          last_inbound_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
        })
        .eq('id', convId);
    }

    let texts: string[];
    try {
      const bubbles = await this.setter.respond(orgId, convId, 'setter', {
        contactName: name,
        persist: true,
      });
      texts = bubbles.map((b) => b.content);
    } catch (err) {
      this.logger.error(`ManyChat: fallo generando respuesta: ${String(err)}`);
      texts = [];
    }
    if (texts.length === 0) texts = ['ahora mismo no puedo responderte, te escribo en un momento'];

    return this.reply(token, texts, subscriberId);
  }

  private async upsertConversation(
    orgId: string,
    subscriberId: string,
    name: string,
  ): Promise<string> {
    const { data: existing } = await this.supabase.admin
      .from('conversations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('external_subscriber_id', subscriberId)
      .eq('is_test', false)
      .maybeSingle();
    if (existing) return existing.id as string;

    const { data, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        organization_id: orgId,
        provider: 'instagram',
        contact_name: name || 'Lead',
        external_subscriber_id: subscriberId,
        contact_external_id: subscriberId,
        source: 'manychat',
        consent_optin: true,
        mode: 'setter',
        mode_locked: true,
        ai_enabled: true,
        is_test: false,
        stage: 'new',
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  private reply(token: string, texts: string[], subscriberId?: string): ManyChatResponse {
    const base = this.config.get<string>('WEBHOOK_BASE_URL') ?? '';
    const callbackUrl = base
      ? `${base.replace(/\/$/, '')}/api/integrations/manychat/dynamic?token=${token}`
      : undefined;

    const res: ManyChatResponse = {
      version: 'v2',
      content: {
        type: 'instagram',
        messages: texts.map((t) => ({ type: 'text', text: t })),
        actions: [],
        quick_replies: [],
      },
    };

    // Mantenemos la conversación abierta: el siguiente mensaje vuelve a la IA.
    if (callbackUrl && subscriberId) {
      res.content.external_message_callback = {
        url: callbackUrl,
        method: 'post',
        payload: {
          subscriber_id: subscriberId,
          last_input_text: '{{last_input_text}}',
        },
        timeout: 86400,
      };
    }
    return res;
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
