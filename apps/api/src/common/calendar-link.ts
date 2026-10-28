import { canonicalE164 } from './phone';

export type CalendarPrefill = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

/**
 * Añade al enlace de agenda los datos del contacto para que el formulario de
 * reserva salga relleno y la cita quede en el MISMO contacto del CRM (si el
 * lead teclea otro email/teléfono, GHL crea un contacto nuevo).
 *
 *   - GHL (y por defecto): `first_name`, `last_name`, `email`, `phone`.
 *   - Calendly: `name`, `email`.
 *
 * Solo se añaden los datos que tenemos; el teléfono va en E.164 canónico. Si el
 * enlace ya trae alguno de esos parámetros, se respeta. Nunca lanza: ante un
 * enlace raro devuelve el original.
 */
export function prefillCalendarLink(link: string, data: CalendarPrefill): string {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  } catch {
    return link;
  }
  const set = (key: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v && !url.searchParams.has(key)) url.searchParams.set(key, v);
  };

  const name = cleanName(data.name);
  const [first, ...rest] = name ? name.split(/\s+/) : [];
  const email = data.email?.trim().toLowerCase() || null;
  const phone = canonicalE164(data.phone);

  if (/(^|\.)calendly\.com$/i.test(url.hostname)) {
    set('name', name);
    set('email', email);
  } else {
    set('first_name', first);
    set('last_name', rest.length ? rest.join(' ') : null);
    set('email', email);
    set('phone', phone);
  }
  return url.toString();
}

/**
 * Sustituye en un texto todas las apariciones del enlace de agenda (con o sin
 * protocolo/www) por su versión con datos prellenados.
 */
export function prefillCalendarLinksInText(text: string, link: string, data: CalendarPrefill): string {
  const base = stripScheme(link);
  if (!base) return text;
  const filled = prefillCalendarLink(link, data);
  if (filled === link) return text;
  // Enlace en el texto: opcionalmente con https:// y www., seguido de nada,
  // espacio o puntuación (no de más ruta ni query, que ya sería otro enlace).
  const re = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${escapeRegExp(base)}\\/?(?=[\\s)\\]"'.,;:!?]|$)`, 'gi');
  return text.replace(re, filled);
}

/** Un nombre que no es un nombre (teléfono, 'Lead', email) no se prerrellena. */
function cleanName(name?: string | null): string | null {
  const s = name?.trim();
  if (!s || s === 'Lead' || s.includes('@') || /^\+?[\d\s().-]{6,}$/.test(s)) return null;
  return s;
}

function stripScheme(link: string): string {
  return link
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
