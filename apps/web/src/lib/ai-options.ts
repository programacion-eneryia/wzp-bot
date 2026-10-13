/** Modelos permitidos (deben coincidir con ALLOWED_MODELS del backend). */
export const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (rápido/barato)" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini (rápido/barato)" },
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
];

// Zonas horarias frecuentes (España + Latinoamérica). Si el navegador soporta
// la lista completa IANA, la usamos; si no, caemos a esta selección.
const COMMON_TIMEZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Costa_Rica",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
  "UTC",
];

export function timezoneOptions(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (Array.isArray(all) && all.length > 0) return all;
  } catch {
    // navegador sin soporte → lista común
  }
  return COMMON_TIMEZONES;
}
