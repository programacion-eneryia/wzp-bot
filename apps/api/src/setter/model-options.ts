/**
 * Modelos LLM permitidos para el setter (slugs de OpenRouter). El desplegable del
 * frontend usa esta misma lista, y el backend la valida al guardar: si llega un
 * valor fuera de aquí, lo ignoramos y se usa el modelo por defecto, en vez de
 * intentar llamar a un modelo inexistente (que dejaría al bot sin responder).
 */
export const ALLOWED_MODELS: { value: string; label: string }[] = [
  { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (recomendado)' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (rápido/barato)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (rápido/barato)' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
];

const ALLOWED_MODEL_VALUES = new Set(ALLOWED_MODELS.map((m) => m.value));

/** ¿Es un modelo de la lista permitida? */
export function isAllowedModel(model: string | null | undefined): boolean {
  return typeof model === 'string' && ALLOWED_MODEL_VALUES.has(model);
}

/** Valida que una cadena sea una zona horaria IANA real (p.ej. "Europe/Madrid"). */
export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
