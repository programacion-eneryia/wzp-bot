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

/** Variantes con las que puede estar guardado un teléfono (`+34…` y `34…`). */
export function phoneVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, '');
  return [`+${digits}`, digits];
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
