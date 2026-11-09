/**
 * Utilidades de fecha/hora para que el bot sepa "qué hora es" para la persona
 * con la que habla y pueda quedar en retomar la conversación más tarde.
 */

/** Zona horaria principal por prefijo telefónico (los más largos primero al buscar). */
const TZ_BY_PREFIX: Record<string, string> = {
  '1809': 'America/Santo_Domingo',
  '1829': 'America/Santo_Domingo',
  '1849': 'America/Santo_Domingo',
  '1787': 'America/Puerto_Rico',
  '1939': 'America/Puerto_Rico',
  '593': 'America/Guayaquil',
  '591': 'America/La_Paz',
  '595': 'America/Asuncion',
  '598': 'America/Montevideo',
  '502': 'America/Guatemala',
  '503': 'America/El_Salvador',
  '504': 'America/Tegucigalpa',
  '505': 'America/Managua',
  '506': 'America/Costa_Rica',
  '507': 'America/Panama',
  '351': 'Europe/Lisbon',
  '352': 'Europe/Luxembourg',
  '212': 'Africa/Casablanca',
  '34': 'Europe/Madrid',
  '57': 'America/Bogota',
  '52': 'America/Mexico_City',
  '56': 'America/Santiago',
  '54': 'America/Argentina/Buenos_Aires',
  '51': 'America/Lima',
  '58': 'America/Caracas',
  '55': 'America/Sao_Paulo',
  '53': 'America/Havana',
  '33': 'Europe/Paris',
  '39': 'Europe/Rome',
  '49': 'Europe/Berlin',
  '44': 'Europe/London',
  '41': 'Europe/Zurich',
  '43': 'Europe/Vienna',
  '32': 'Europe/Brussels',
  '31': 'Europe/Amsterdam',
  '353': 'Europe/Dublin',
  '45': 'Europe/Copenhagen',
  '46': 'Europe/Stockholm',
  '47': 'Europe/Oslo',
  '48': 'Europe/Warsaw',
  '30': 'Europe/Athens',
  '90': 'Europe/Istanbul',
  '971': 'Asia/Dubai',
};

/**
 * Zona horaria más probable de un teléfono por su prefijo de país. `null` si
 * no se reconoce o es ambiguo (p.ej. +1, que cubre varias zonas).
 */
export function timezoneForPhone(phone?: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  for (const len of [4, 3, 2]) {
    const tz = TZ_BY_PREFIX[digits.slice(0, len)];
    if (tz) return tz;
  }
  return null;
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTz(tz?: string | null, fallback = 'Europe/Madrid'): string {
  return tz && isValidTz(tz) ? tz : fallback;
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; weekday: number };

function partsIn(dateMs: number, tz: string): Parts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const get = (type: string) => f.formatToParts(new Date(dateMs)).find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')) % 24,
    mi: Number(get('minute')),
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
  };
}

/** Desfase (ms) de la zona respecto a UTC en un instante dado. */
function tzOffsetMs(dateMs: number, tz: string): number {
  const p = partsIn(dateMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, 0, 0);
  const truncated = Math.floor(dateMs / 60_000) * 60_000;
  return asUtc - truncated;
}

/** Instante UTC que corresponde a una hora "de pared" en una zona horaria. */
export function zonedTimeToUtc(
  local: { y: number; m: number; d: number; h: number; mi: number },
  tz: string,
): Date {
  const guess = Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, 0, 0);
  let utc = guess - tzOffsetMs(guess, tz);
  // Segundo ajuste por si el desfase cambia justo ahí (cambio de hora).
  utc = guess - tzOffsetMs(utc, tz);
  return new Date(utc);
}

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_ES_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** "lunes 10 de noviembre de 2026, 16:05". */
export function formatDateTimeEs(dateMs: number, tz: string): string {
  const p = partsIn(dateMs, tz);
  return `${DAYS_ES[p.weekday]} ${p.d} de ${MONTHS_ES[p.m - 1]} de ${p.y}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** "lun 10/11 16:05" (marca compacta para el historial). */
export function formatShortEs(dateMs: number, tz: string): string {
  const p = partsIn(dateMs, tz);
  return `${DAYS_ES_SHORT[p.weekday]} ${pad(p.d)}/${pad(p.m)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** Marca con la que el modelo pide retomar la conversación más tarde. */
export const RESUME_DIRECTIVE_RE = /\[\[\s*RETOMAR\s*:\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*\]\]/i;

/** Límite para una cita de retomar: más allá, se ignora (el modelo se equivocó). */
const MAX_RESUME_DAYS = 45;

/**
 * Extrae la marca `[[RETOMAR: AAAA-MM-DD HH:MM]]` (hora local de la persona) de
 * la salida del modelo. Devuelve el texto limpio y el instante UTC, o `null` si
 * no hay marca, es inválida, ya pasó o está demasiado lejos.
 */
export function extractResumeDirective(
  raw: string,
  tz: string,
  nowMs = Date.now(),
): { text: string; resumeAt: Date | null } {
  const m = RESUME_DIRECTIVE_RE.exec(raw);
  const text = raw.replace(new RegExp(RESUME_DIRECTIVE_RE.source, 'gi'), ' ').replace(/[ \t]{2,}/g, ' ').trim();
  if (!m) return { text, resumeAt: null };
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) {
    return { text, resumeAt: null };
  }
  const at = zonedTimeToUtc({ y, m: mo, d, h, mi }, tz);
  const ms = at.getTime();
  if (!Number.isFinite(ms)) return { text, resumeAt: null };
  // Un par de minutos de margen por si el modelo redondeó "ahora mismo".
  if (ms < nowMs - 2 * 60_000) return { text, resumeAt: null };
  if (ms > nowMs + MAX_RESUME_DAYS * 24 * 60 * 60_000) return { text, resumeAt: null };
  return { text, resumeAt: at };
}
