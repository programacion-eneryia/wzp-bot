/**
 * Reconocer la plantilla de primer contacto que una cuenta manda a sus leads
 * ("Hola {nombre}, soy David 👋 / Acabo de ver que has rellenado…") cuando
 * nos llega sin aviso previo del lead.
 */

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Longitud mínima del cuerpo para fiarnos de que identifica una plantilla. */
const MIN_BODY_LENGTH = 40;

/**
 * "Esqueleto" de una plantilla: el texto sin su primera línea (el saludo, que
 * lleva el nombre de cada persona) y normalizado. Null si no tiene varias
 * líneas o el cuerpo es demasiado corto para identificarla con seguridad.
 */
export function templateSkeleton(text: string): string | null {
  const lines = normalize(text).split('\n');
  if (lines.length < 2) return null;
  const body = lines.slice(1).join('\n').trim();
  return body.length >= MIN_BODY_LENGTH ? body : null;
}

/** Nombre al que va dirigido un saludo tipo "Hola María López , soy David 👋". */
export function greetingName(text: string): string | null {
  const first = normalize(text).split('\n')[0] ?? '';
  const m = /^(?:hola|hey|ey|buenas|qué tal|que tal)[,!]?\s+(.+)$/i.exec(first);
  if (!m) return null;
  const name = m[1]
    .split(/\s*(?:[,.!¡¿?]|\bsoy\b)/i)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || name.length > 60) return null;
  return /^(?:buenas|qué tal|que tal)$/i.test(name) ? null : name;
}
