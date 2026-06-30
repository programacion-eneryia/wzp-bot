import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Cliente de la WhatsApp Cloud API (capa oficial de Meta). Se usa para:
 *   - El PRIMER toque proactivo a leads de anuncios (plantillas aprobadas).
 *   - Enviar texto dentro de la ventana de 24h.
 *   - Verificar la firma `X-Hub-Signature-256` de los webhooks de Meta.
 *
 * Multi-tenant: cada canal guarda su `phone_number_id` y su token (cifrado); la
 * firma del webhook se valida con el App Secret global de NUESTRA app de Meta.
 */
@Injectable()
export class WhatsAppCloudService {
  private readonly logger = new Logger(WhatsAppCloudService.name);

  constructor(private readonly config: ConfigService) {}

  private get version(): string {
    return this.config.get<string>('META_GRAPH_VERSION') ?? 'v23.0';
  }

  private url(path: string): string {
    return `https://graph.facebook.com/${this.version}/${path}`;
  }

  /** Envía un mensaje de texto (solo válido dentro de la ventana de 24h). */
  async sendText(
    phoneNumberId: string,
    token: string,
    to: string,
    text: string,
  ): Promise<{ id: string | null }> {
    return this.post(phoneNumberId, token, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    });
  }

  /**
   * Envía una plantilla aprobada (primer toque proactivo / fuera de ventana).
   * `bodyParams` rellena las variables {{1}}, {{2}}… del cuerpo de la plantilla.
   */
  async sendTemplate(
    phoneNumberId: string,
    token: string,
    to: string,
    templateName: string,
    language = 'es',
    bodyParams: string[] = [],
  ): Promise<{ id: string | null }> {
    const components =
      bodyParams.length > 0
        ? [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: t })) }]
        : undefined;
    return this.post(phoneNumberId, token, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language }, components },
    });
  }

  private async post(
    phoneNumberId: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string | null }> {
    const res = await fetch(this.url(`${phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(`Cloud API ${res.status}: ${json.error?.message ?? 'error'}`);
    }
    return { id: json.messages?.[0]?.id ?? null };
  }

  // ---------------------------------------------------------------------------
  // EMBEDDED SIGNUP (onboarding del número del cliente a NUESTRA app de Meta)
  // ---------------------------------------------------------------------------

  /**
   * Intercambia el `code` del Embedded Signup por un token de acceso del negocio
   * (token de larga duración del usuario de sistema vinculado a la WABA).
   */
  async exchangeCode(code: string): Promise<string> {
    const appId = this.config.getOrThrow<string>('META_APP_ID');
    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
    const qs = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code,
    });
    const res = await fetch(this.url(`oauth/access_token?${qs.toString()}`));
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.access_token) {
      throw new Error(`No se pudo canjear el código: ${json.error?.message ?? res.status}`);
    }
    return json.access_token;
  }

  /**
   * Registra el número en la Cloud API (necesario tras el signup). Usa un PIN de
   * 6 dígitos para el 2FA del número.
   */
  async registerPhone(phoneNumberId: string, token: string, pin: string): Promise<void> {
    const res = await fetch(this.url(`${phoneNumberId}/register`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      // Si ya estaba registrado, Meta devuelve error; lo ignoramos.
      const msg = json.error?.message ?? '';
      if (!/already/i.test(msg)) {
        this.logger.warn(`register phone ${phoneNumberId}: ${res.status} ${msg}`);
      }
    }
  }

  /** Suscribe NUESTRA app a la WABA del cliente para recibir sus webhooks. */
  async subscribeApp(wabaId: string, token: string): Promise<void> {
    const res = await fetch(this.url(`${wabaId}/subscribed_apps`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`No se pudo suscribir la app a la WABA: ${json.error?.message ?? res.status}`);
    }
  }

  /** Lee info del número (display + número formateado). */
  async getPhoneNumberInfo(
    phoneNumberId: string,
    token: string,
  ): Promise<{ display_phone_number?: string; verified_name?: string }> {
    const res = await fetch(
      this.url(`${phoneNumberId}?fields=display_phone_number,verified_name`),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
    };
  }

  /**
   * Verifica la firma `X-Hub-Signature-256` del webhook de Meta sobre el cuerpo
   * crudo. Imprescindible para no aceptar payloads falsificados.
   */
  verifySignature(appSecret: string, rawBody: Buffer | undefined, header?: string): boolean {
    if (!appSecret || !rawBody || !header) return false;
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
