import type { UnipileAttendee } from '../unipile/unipile.service';

/**
 * Teléfono en formato `+<dígitos>` a partir de lo que mande el proveedor:
 * `+34 677 10 26 43`, `34677102643`, `34677102643@s.whatsapp.net`…
 * Los ids internos de WhatsApp (`…@lid`) NO son teléfonos → null.
 */
export function toE164(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.includes('@lid')) return null;
  const wa = /^(\d{6,15})@s\.whatsapp\.net$/.exec(s);
  if (wa) return `+${wa[1]}`;
  if (s.includes('@')) return null;
  if (!/^\+?[\d\s().-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15 ? `+${digits}` : null;
}

/**
 * Teléfono solo si viene como JID de WhatsApp (`<num>@s.whatsapp.net`). Para
 * ids de proveedor: en Instagram/LinkedIn son dígitos que NO son teléfonos.
 */
export function phoneFromJid(raw?: string | null): string | null {
  const m = raw ? /^(\d{6,15})@s\.whatsapp\.net$/.exec(raw.trim()) : null;
  return m ? `+${m[1]}` : null;
}

/**
 * Dígitos "canónicos" (E.164 tal y como lo guardan GHL y los formularios) de
 * un teléfono, quitando lo que WhatsApp añade o cambia en algunos países:
 *   - México: WhatsApp expone `52 1 + 10 dígitos`; E.164 es `52 + 10`.
 *   - Argentina: WhatsApp expone `54 9 + 10 dígitos`; E.164 es `54 + 10`.
 *   - Brasil: los móviles llevan un 9 delante (`55 DD 9 XXXX XXXX`); algunos
 *     números antiguos siguen circulando sin él (`55 DD XXXX XXXX`). La forma
 *     canónica es CON el 9 (es el número real desde 2016).
 * `+52 55 1234 5678` y `521 55 1234 5678` son el mismo número.
 */
export function canonicalDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (/^521\d{10}$/.test(d)) return `52${d.slice(3)}`;
  if (/^549\d{10}$/.test(d)) return `54${d.slice(3)}`;
  // Brasil sin el 9º dígito: 55 + DDD (2) + 8 dígitos que empiezan por 6-9 (móvil).
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

/** Teléfono canónico `+E.164` (el formato con el que se escribe en el CRM). */
export function canonicalE164(raw?: string | null): string | null {
  const e = toE164(raw);
  return e ? `+${canonicalDigits(e)}` : null;
}

/** Mismo número aunque uno lleve el prefijo de móvil de México/Argentina o le falte el 9 de Brasil. */
export function samePhone(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const ca = canonicalDigits(a);
  return ca.length >= 6 && ca === canonicalDigits(b);
}

/** Dígitos con los que WhatsApp marca ese número (México/Argentina con el prefijo de móvil). */
export function whatsappDigits(raw: string): string {
  const c = canonicalDigits(raw);
  if (/^52\d{10}$/.test(c)) return `521${c.slice(2)}`;
  if (/^54\d{10}$/.test(c)) return `549${c.slice(2)}`;
  return c;
}

/**
 * Variantes con las que puede estar guardado un teléfono: con y sin `+`, con y
 * sin el prefijo de móvil de México/Argentina, y con y sin el 9 de Brasil.
 */
export function phoneVariants(e164: string): string[] {
  const c = canonicalDigits(e164);
  const set = new Set([e164.replace(/\D/g, ''), c, whatsappDigits(e164)]);
  // Brasil: también la forma antigua sin el 9º dígito.
  if (/^55\d{2}9[6-9]\d{7}$/.test(c)) set.add(`${c.slice(0, 4)}${c.slice(5)}`);
  return [...set].filter(Boolean).flatMap((d) => [`+${d}`, d]);
}

/** Un "nombre" que en realidad es un número (`+34 6 77 10 26 43`). */
export function looksLikePhone(name?: string | null): boolean {
  if (!name) return false;
  const s = name.trim();
  return /^\+?[\d\s().-]{6,}$/.test(s) && s.replace(/\D/g, '').length >= 6;
}

/** Nombre que no aporta nada: vacío, 'Lead' o un número. */
export function isPlaceholderName(name?: string | null): boolean {
  const s = name?.trim();
  return !s || s === 'Lead' || looksLikePhone(s);
}

/**
 * Nombre con el que actualizar el contacto, o null si el actual es mejor. Un
 * nombre real (p.ej. el del formulario de GHL) nunca se pisa con un número.
 */
export function betterName(current?: string | null, incoming?: string | null): string | null {
  const inc = incoming?.trim();
  const cur = current?.trim();
  if (!inc || inc === cur) return null;
  if (!cur || cur === 'Lead') return inc;
  if (looksLikePhone(cur) && !isPlaceholderName(inc)) return inc;
  return null;
}

/**
 * Teléfono real del participante. Preferimos `specifics.phone_number`; si no,
 * `public_identifier`/`provider_id` cuando son `<num>@s.whatsapp.net`.
 */
export function phoneOfAttendee(att: UnipileAttendee): string | null {
  return (
    toE164(att.specifics?.phone_number) ??
    phoneFromJid(att.public_identifier) ??
    phoneFromJid(att.provider_id)
  );
}
