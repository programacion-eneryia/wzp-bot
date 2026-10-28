import { Logger } from '@nestjs/common';

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export type GhlContact = {
  id: string;
  phone: string | null;
  email: string | null;
  tags: string[];
  source: string | null;
};

type Response = { status: number; json: Record<string, unknown> };

/**
 * Cliente mínimo de la API v2 de GoHighLevel para contactos, pensado para no
 * pisar datos ajenos:
 *   - `findDuplicate` busca por teléfono/email (GET /contacts/search/duplicate).
 *   - `addTags` AÑADE etiquetas (POST /contacts/{id}/tags); nunca reemplaza.
 *   - `updateContact` solo manda los campos que se le pasan.
 * Reintenta con espera creciente ante 429/5xx y nunca registra el token.
 */
export class GhlApi {
  private readonly logger = new Logger(GhlApi.name);
  /** Se activa si la búsqueda devuelve 401/403 (token sin permiso de lectura). */
  searchUnavailable = false;

  constructor(private readonly token: string) {}

  async getContact(id: string): Promise<GhlContact | null> {
    const r = await this.request('GET', `/contacts/${encodeURIComponent(id)}`);
    if (!r || r.status !== 200) return null;
    return toContact(r.json.contact);
  }

  async findDuplicate(
    locationId: string,
    by: { phone?: string; email?: string },
  ): Promise<GhlContact | null> {
    if (this.searchUnavailable) return null;
    const qs = new URLSearchParams({ locationId });
    if (by.phone) qs.set('number', by.phone);
    if (by.email) qs.set('email', by.email);
    const r = await this.request('GET', `/contacts/search/duplicate?${qs.toString()}`);
    if (!r) return null;
    if (r.status === 401 || r.status === 403) {
      this.searchUnavailable = true;
      this.logger.warn(
        'El token de GHL no permite buscar contactos (falta el permiso contacts.readonly): se usará el upsert de GHL',
      );
      return null;
    }
    if (r.status !== 200) return null;
    return toContact(r.json.contact);
  }

  async addTags(contactId: string, tags: string[]): Promise<boolean> {
    if (!tags.length) return true;
    const r = await this.request('POST', `/contacts/${encodeURIComponent(contactId)}/tags`, { tags });
    return Boolean(r && r.status < 300);
  }

  async updateContact(contactId: string, patch: Record<string, unknown>): Promise<boolean> {
    const r = await this.request('PUT', `/contacts/${encodeURIComponent(contactId)}`, patch);
    return Boolean(r && r.status < 300);
  }

  async upsertContact(body: Record<string, unknown>): Promise<{ id: string; isNew: boolean } | null> {
    const r = await this.request('POST', '/contacts/upsert', body);
    if (!r || r.status >= 300) return null;
    const contact = toContact(r.json.contact);
    return contact ? { id: contact.id, isNew: Boolean(r.json.new) } : null;
  }

  /**
   * Crea el contacto. Si la subcuenta no admite duplicados y GHL detecta uno
   * (400 con `meta.contactId`), devuelve ese id en `duplicateOf`.
   */
  async createContact(
    body: Record<string, unknown>,
  ): Promise<{ id: string; duplicateOf?: string } | null> {
    const r = await this.request('POST', '/contacts/', body);
    if (!r) return null;
    if (r.status < 300) {
      const contact = toContact(r.json.contact);
      return contact ? { id: contact.id } : null;
    }
    const meta = (r.json.meta ?? {}) as Record<string, unknown>;
    if (r.status === 400 && typeof meta.contactId === 'string') {
      return { id: meta.contactId, duplicateOf: meta.contactId };
    }
    return null;
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`${GHL_API}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            version: GHL_API_VERSION,
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) {
          await sleep(retryDelayMs(res.headers.get('retry-after'), attempt));
          continue;
        }
        if (res.status >= 300) {
          this.logger.warn(
            `GHL ${method} ${path.split('?')[0]} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`,
          );
        }
        return { status: res.status, json };
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(retryDelayMs(null, attempt));
          continue;
        }
        this.logger.warn(`GHL ${method} ${path.split('?')[0]} error: ${String(err)}`);
        return null;
      }
    }
    return null;
  }
}

function toContact(raw: unknown): GhlContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id) return null;
  return {
    id: c.id,
    phone: typeof c.phone === 'string' && c.phone ? c.phone : null,
    email: typeof c.email === 'string' && c.email ? c.email : null,
    tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    source: typeof c.source === 'string' && c.source ? c.source : null,
  };
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const secs = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 10) * 1000;
  return 800 * 2 ** (attempt - 1);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
