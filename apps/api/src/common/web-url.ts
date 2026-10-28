import type { ConfigService } from '@nestjs/config';

/**
 * URL del frontend a la que devolver al usuario tras un asistente externo
 * (conectar WhatsApp, calendario…). `WEB_URL`/`CORS_ORIGINS` pueden traer
 * varios orígenes separados por comas; usamos el del que viene la petición si
 * está en la lista (así cada dominio vuelve a sí mismo) y, si no, el primero
 * que no sea el propio backend.
 */
export function resolveWebUrl(config: ConfigService, requestOrigin?: string | null): string {
  const raw = [config.get<string>('WEB_URL'), config.get<string>('CORS_ORIGINS')]
    .filter(Boolean)
    .join(',');
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\//i.test(s));
  const apiHost = hostOf(config.get<string>('WEBHOOK_BASE_URL') ?? config.get<string>('API_URL'));
  const candidates = list.filter((u) => hostOf(u) !== apiHost);

  const origin = requestOrigin?.trim().replace(/\/+$/, '');
  if (origin && candidates.some((u) => u.toLowerCase() === origin.toLowerCase())) return origin;
  return candidates[0] ?? list[0] ?? 'http://localhost:3000';
}

function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
