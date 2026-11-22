/**
 * Marca con la que el modelo pide enviar un archivo de la biblioteca:
 * `[[ARCHIVO: nombre]]`. Se extrae de la salida antes de enviar y el archivo
 * se manda justo después del texto que la precede.
 */
export const MEDIA_DIRECTIVE_EXAMPLE = '[[ARCHIVO: nombre del archivo]]';

export const MEDIA_DIRECTIVE_RE =
  /\[\[\s*(?:ARCHIVO|ENVIAR|ADJUNTO|AUDIO|VIDEO|VÍDEO|IMAGEN|DOCUMENTO)\s*:\s*([^\]]{1,120}?)\s*\]\]/gi;

export type MediaRef = { id: string; name: string; kind: string };

export type MediaSegment = {
  /** Texto que va antes del archivo (puede estar vacío). */
  text: string;
  /** Archivo a enviar tras ese texto; `null` en el último tramo si no hay más. */
  media: MediaRef | null;
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

/** Busca el archivo por nombre: exacto, luego por inclusión. */
export function matchMedia<T extends { name: string }>(
  ref: string,
  assets: T[],
): T | null {
  const want = norm(ref);
  if (!want) return null;
  return (
    assets.find((a) => norm(a.name) === want) ??
    assets.find(
      (a) => norm(a.name).includes(want) || want.includes(norm(a.name)),
    ) ??
    null
  );
}

/**
 * Divide la salida del modelo en tramos texto → archivo. Las marcas cuyo
 * nombre no corresponde a ningún archivo se eliminan (y se devuelven en
 * `unknown` para el log). Un mismo archivo no se envía dos veces en la misma
 * respuesta.
 */
export function extractMediaDirectives(
  raw: string,
  assets: MediaRef[],
): { segments: MediaSegment[]; unknown: string[]; hasMedia: boolean } {
  const segments: MediaSegment[] = [];
  const unknown: string[] = [];
  const used = new Set<string>();
  let last = 0;
  let hasMedia = false;
  const re = new RegExp(MEDIA_DIRECTIVE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  let pending = '';
  while ((m = re.exec(raw)) !== null) {
    pending += raw.slice(last, m.index);
    last = m.index + m[0].length;
    const asset = matchMedia(m[1], assets);
    if (!asset || used.has(asset.id)) {
      if (!asset) unknown.push(m[1].trim());
      continue;
    }
    used.add(asset.id);
    hasMedia = true;
    segments.push({ text: pending.trim(), media: asset });
    pending = '';
  }
  pending += raw.slice(last);
  segments.push({ text: pending.trim(), media: null });
  return { segments, unknown, hasMedia };
}
