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
  timestamp?: string;
  unread_count?: number;
  [key: string]: unknown;
};

export type UnipileMessage = {
  id: string;
  text?: string;
  is_sender?: number | boolean;
  timestamp?: string;
  date?: string;
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

  /** Lista los mensajes de un chat (los más recientes). */
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
      throw new HttpException(`No se pudo enviar el mensaje (${res.status})`, res.status);
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
      throw new HttpException(`No se pudo iniciar el chat (${res.status})`, res.status);
    }
    return (body ? safeJson(body) : {}) as { chat_id?: string };
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
