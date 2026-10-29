import {
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Proveedores de Unipile que exponemos como canales. */
export type UnipileProvider = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'LINKEDIN' | 'TELEGRAM';

export type HostedAuthLinkParams = {
  /** Identificador interno (nuestro channel.id). Unipile lo devuelve en el notify_url. */
  name: string;
  providers: UnipileProvider[];
  notify_url?: string;
  success_redirect_url?: string;
  failure_redirect_url?: string;
};

export type UnipileAccount = {
  id: string;
  name?: string;
  type?: string;
  created_at?: string;
  sources?: Array<{ id?: string; status?: string }>;
  [key: string]: unknown;
};

export type UnipileChat = {
  id: string;
  name?: string;
  provider_id?: string;
  attendee_provider_id?: string;
  account_id?: string;
  /** 0 = privado, 1 = grupo. */
  type?: number;
  timestamp?: string;
  unread_count?: number;
  [key: string]: unknown;
};

/** Margen para dar por "recién enviado" un mensaje al verificar un envío dudoso. */
const JUST_SENT_MS = 3 * 60_000;
const JUST_SENT_TRIES = 5;
const JUST_SENT_POLL_MS = 2_000;

function msgTimeMs(m: UnipileMessage): number {
  const t = Date.parse(String(m.timestamp ?? m.date ?? ''));
  return Number.isFinite(t) ? t : 0;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export type UnipileAttachment = {
  id: string;
  /** 'audio' | 'img' | 'video' | 'file' | 'sticker' … */
  type?: string;
  mimetype?: string;
  file_name?: string;
  duration?: number;
  voice_note?: boolean;
  [key: string]: unknown;
};

export type UnipileMessage = {
  id: string;
  text?: string;
  is_sender?: number | boolean;
  timestamp?: string;
  date?: string;
  attachments?: UnipileAttachment[];
  [key: string]: unknown;
};

export type UnipileAttendee = {
  id?: string;
  name?: string;
  /** Id interno de WhatsApp (puede ser `<num>@lid`, que NO es el teléfono). */
  provider_id?: string;
  /** Suele venir como `<telefono>@s.whatsapp.net`. */
  public_identifier?: string;
  /** 1 = somos nosotros (la cuenta conectada), 0 = el contacto. */
  is_self?: number | boolean;
  picture_url?: string;
  specifics?: {
    provider?: string;
    /** Teléfono real ya formateado, p.ej. "+34618026118". */
    phone_number?: string;
    lid?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type UnipileCalendar = {
  id: string;
  name?: string;
  is_primary?: boolean;
  account_id?: string;
  [key: string]: unknown;
};

export type UnipileCalendarEvent = {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  meeting_url?: string;
  conferencing?: { url?: string };
  [key: string]: unknown;
};

/**
 * Cliente HTTP fino sobre la API de Unipile.
 *
 * Toda comunicación con Unipile pasa por aquí: centralizamos la base URL, la
 * API key (secreto que NUNCA sale del backend) y el manejo de errores.
 */
@Injectable()
export class UnipileService implements OnModuleInit {
  private readonly logger = new Logger(UnipileService.name);
  private baseUrl!: string;
  private apiUrl!: string;
  private apiKey!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // DSN tipo "api41.unipile.com:17152"
    const dsn = this.config.getOrThrow<string>('UNIPILE_DSN');
    this.apiUrl = `https://${dsn}`;
    this.baseUrl = `${this.apiUrl}/api/v1`;
    this.apiKey = this.config.getOrThrow<string>('UNIPILE_API_KEY');
  }

  /** URL base del servidor Unipile (campo `api_url` requerido por hosted auth). */
  get serverUrl(): string {
    return this.apiUrl;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'X-API-KEY': this.apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    const body = text ? safeJson(text) : null;

    if (!res.ok) {
      this.logger.error(`Unipile ${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
      const message =
        (body && typeof body === 'object' && 'detail' in body
          ? String((body as Record<string, unknown>).detail)
          : null) ?? `Error de Unipile (${res.status})`;
      throw new HttpException(message, res.status);
    }

    return body as T;
  }

  /** Crea un enlace de autenticación hosted para conectar una cuenta. */
  async createHostedAuthLink(params: HostedAuthLinkParams): Promise<{ url: string }> {
    // Expira en 1 hora (ISO 8601 con milisegundos, como exige Unipile).
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return this.request<{ object: string; url: string }>('/hosted/accounts/link', {
      method: 'POST',
      body: JSON.stringify({
        type: 'create',
        api_url: this.apiUrl,
        expiresOn,
        ...params,
      }),
    });
  }

  /**
   * Enlace hosted para RECONECTAR una cuenta existente (p. ej. WhatsApp cerró
   * la sesión del dispositivo vinculado). Mantiene el mismo `account_id`, así
   * que los chats y su histórico siguen siendo los mismos.
   */
  async createReconnectLink(
    accountId: string,
    params: Omit<HostedAuthLinkParams, 'providers'>,
  ): Promise<{ url: string }> {
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return this.request<{ object: string; url: string }>('/hosted/accounts/link', {
      method: 'POST',
      body: JSON.stringify({
        type: 'reconnect',
        reconnect_account: accountId,
        api_url: this.apiUrl,
        expiresOn,
        ...params,
      }),
    });
  }

  /** ¿La cuenta está operativa? (todas sus fuentes en OK o aún conectando). */
  static isAccountHealthy(account: UnipileAccount): boolean {
    const sources = account.sources ?? [];
    if (sources.length === 0) return true;
    return sources.every((s) => !s.status || s.status === 'OK' || s.status === 'CONNECTING');
  }

  /** Lista todas las cuentas conectadas en esta cuenta de Unipile. */
  async listAccounts(): Promise<UnipileAccount[]> {
    const data = await this.request<{ items?: UnipileAccount[]; object?: string }>('/accounts');
    return data.items ?? [];
  }

  async getAccount(accountId: string): Promise<UnipileAccount> {
    return this.request<UnipileAccount>(`/accounts/${accountId}`);
  }

  /** Desconecta (elimina) una cuenta en Unipile. */
  async deleteAccount(accountId: string): Promise<void> {
    await this.request(`/accounts/${accountId}`, { method: 'DELETE' });
  }

  /** Lista los chats de una cuenta (los más recientes). */
  async listChats(accountId: string, limit = 30): Promise<UnipileChat[]> {
    const data = await this.request<{ items?: UnipileChat[] }>(
      `/chats?account_id=${encodeURIComponent(accountId)}&limit=${limit}`,
    );
    return data.items ?? [];
  }

  /**
   * Lista los participantes de un chat. En WhatsApp 1:1 sirve para sacar el
   * nombre real del contacto (el chat en sí no trae `name` en privados).
   */
  async listChatAttendees(chatId: string): Promise<UnipileAttendee[]> {
    const data = await this.request<{ items?: UnipileAttendee[] }>(
      `/chats/${encodeURIComponent(chatId)}/attendees`,
    );
    return data.items ?? [];
  }

  /** Recupera un mensaje concreto por su id (texto, remitente y adjuntos). */
  async getMessage(messageId: string): Promise<UnipileMessage> {
    return this.request<UnipileMessage>(`/messages/${encodeURIComponent(messageId)}`);
  }

  /** Descarga un adjunto (nota de voz, imagen…) de un mensaje. */
  async downloadAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mime: string }> {
    const res = await fetch(
      `${this.baseUrl}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { 'X-API-KEY': this.apiKey } },
    );
    if (!res.ok) {
      throw new HttpException(`No se pudo descargar el adjunto (${res.status})`, res.status);
    }
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mime: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async listChatMessages(chatId: string, limit = 25): Promise<UnipileMessage[]> {
    const data = await this.request<{ items?: UnipileMessage[] }>(
      `/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
    );
    return data.items ?? [];
  }

  /**
   * Envía un mensaje de texto a un chat existente. Unipile espera multipart/
   * form-data (soporta adjuntos), así que no usamos el helper JSON.
   */
  async sendMessageToChat(chatId: string, text: string): Promise<void> {
    const form = new FormData();
    form.append('text', text);

    const res = await fetch(`${this.baseUrl}/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'X-API-KEY': this.apiKey, accept: 'application/json' },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`Unipile send → ${res.status}: ${detail}`);
      if (detail.includes('disconnected_account')) {
        throw new HttpException('No se pudo enviar el mensaje: cuenta desconectada (disconnected_account)', res.status);
      }
      // WhatsApp a veces entrega el mensaje y aun así Unipile responde con un
      // error (p.ej. `account_restricted` al escribir a contactos nuevos desde
      // un número recién vinculado). Si el último mensaje del chat ya es el
      // nuestro, el envío fue bien: no lo damos por fallido (si no, se repetiría
      // y su eco se tomaría por un mensaje manual que pausa la IA).
      if (await this.wasJustSent(chatId, text)) {
        this.logger.warn(`Unipile send → ${res.status} pero el mensaje consta como enviado en el chat ${chatId}`);
        return;
      }
      throw new HttpException(`No se pudo enviar el mensaje (${res.status})`, res.status);
    }
  }

  /**
   * Chat 1:1 que YA existe en la cuenta con un teléfono (dígitos E.164 sin
   * `+`). `null` si no hay chat o WhatsApp no lo expone por teléfono.
   */
  async findChatByPhone(accountId: string, phoneDigits: string): Promise<string | null> {
    const digits = phoneDigits.replace(/\D/g, '');
    if (digits.length < 6) return null;
    try {
      const data = await this.request<{ items?: UnipileChat[] }>(
        `/chat_attendees/${encodeURIComponent(`${digits}@s.whatsapp.net`)}/chats?account_id=${encodeURIComponent(accountId)}`,
      );
      const chat = (data.items ?? []).find(
        (c) => c.id && (!c.account_id || c.account_id === accountId) && (c.type ?? 0) === 0,
      );
      return chat?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Inicia un chat nuevo con un contacto (primer contacto saliente).
   * `attendeeId` es el provider id del destinatario (p.ej. teléfono en WA).
   */
  async startNewChat(
    accountId: string,
    attendeeId: string,
    text: string,
  ): Promise<{ chat_id?: string }> {
    const form = new FormData();
    form.append('account_id', accountId);
    form.append('attendees_ids', attendeeId);
    form.append('text', text);

    const res = await fetch(`${this.baseUrl}/chats`, {
      method: 'POST',
      headers: { 'X-API-KEY': this.apiKey, accept: 'application/json' },
      body: form,
    });

    const body = await res.text();
    if (!res.ok) {
      this.logger.error(`Unipile startChat → ${res.status}: ${body}`);
      if (body.includes('disconnected_account')) {
        throw new HttpException('No se pudo iniciar el chat: cuenta desconectada (disconnected_account)', res.status);
      }
      // Mismo caso que en `sendMessageToChat`: el mensaje puede haber salido
      // aunque Unipile devuelva error. Comprobamos el chat de ese teléfono.
      const chatId = await this.findChatByPhone(accountId, attendeeId);
      if (chatId && (await this.wasJustSent(chatId, text))) {
        this.logger.warn(`Unipile startChat → ${res.status} pero el mensaje consta como enviado en el chat ${chatId}`);
        return { chat_id: chatId };
      }
      throw new HttpException(`No se pudo iniciar el chat (${res.status})`, res.status);
    }
    return (body ? safeJson(body) : {}) as { chat_id?: string };
  }

  /**
   * ¿Hay en el chat un mensaje nuestro reciente con este texto? El mensaje
   * tarda unos segundos en aparecer en la lista tras enviarse, así que se
   * comprueba varias veces antes de darlo por no enviado.
   */
  private async wasJustSent(chatId: string, text: string): Promise<boolean> {
    const wanted = normalizeText(text);
    for (let i = 0; i < JUST_SENT_TRIES; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, JUST_SENT_POLL_MS));
      try {
        const msgs = await this.listChatMessages(chatId, 5);
        const hit = msgs.some((m) => {
          if (!(m.is_sender === 1 || m.is_sender === true)) return false;
          if (normalizeText(m.text ?? '') !== wanted) return false;
          const at = msgTimeMs(m);
          return at === 0 || Date.now() - at < JUST_SENT_MS;
        });
        if (hit) return true;
      } catch {
        // seguimos intentando
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // CALENDARIO (Google / Outlook vía Unipile)
  // ---------------------------------------------------------------------------

  /** Enlace hosted para conectar un calendario (Google/Outlook). */
  async createCalendarHostedAuthLink(params: {
    name: string;
    providers: Array<'GOOGLE' | 'OUTLOOK'>;
    notify_url?: string;
    success_redirect_url?: string;
    failure_redirect_url?: string;
  }): Promise<{ url: string }> {
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return this.request<{ object: string; url: string }>('/hosted/accounts/link', {
      method: 'POST',
      body: JSON.stringify({
        type: 'create',
        api_url: this.apiUrl,
        expiresOn,
        ...params,
      }),
    });
  }

  /** Lista los calendarios de una cuenta conectada. */
  async listCalendars(accountId: string): Promise<UnipileCalendar[]> {
    const data = await this.request<{ items?: UnipileCalendar[] }>(
      `/calendars?account_id=${encodeURIComponent(accountId)}`,
    );
    return data.items ?? [];
  }

  /** Lista eventos (ocupados) de un calendario en un rango ISO. */
  async listCalendarEvents(
    calendarId: string,
    rangeStartIso: string,
    rangeEndIso: string,
  ): Promise<UnipileCalendarEvent[]> {
    const qs = new URLSearchParams({ start: rangeStartIso, end: rangeEndIso });
    const data = await this.request<{ items?: UnipileCalendarEvent[] }>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`,
    );
    return data.items ?? [];
  }

  /** Crea un evento (con asistentes y, si procede, enlace de videollamada). */
  async createCalendarEvent(
    calendarId: string,
    payload: {
      title: string;
      start: string; // ISO
      end: string; // ISO
      attendees?: { email?: string; display_name?: string }[];
      description?: string;
      conferencing?: boolean;
    },
  ): Promise<UnipileCalendarEvent> {
    return this.request<UnipileCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
