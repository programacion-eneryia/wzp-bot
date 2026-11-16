/**
 * Protección contra el "pensamiento en voz alta" del modelo.
 *
 * Ocurrió en producción (cuenta real, dos veces en dos días): antes del
 * mensaje de verdad, el modelo escribió su razonamiento como primer globo y se
 * envió al lead tal cual ("Con 5-10€ no va a poder pagar mi acompañamiento. Le
 * recomiendo el vídeo de YouTube sin ofrecer llamada", "Puedo ofrecerle agendar
 * esa semana"). Pasa cuando tiene que aplicar una regla del agente (umbral de
 * capital, ventana del calendario) y delibera en tercera persona sobre la
 * persona con la que habla.
 *
 * Dos capas:
 *  1. El prompt le da un sitio privado para pensar (<pensamiento>…</pensamiento>)
 *     que aquí se elimina SIEMPRE antes de trocear en globos.
 *  2. Cada globo pasa por una heurística: si delibera (habla del lead en tercera
 *     persona, de reglas, de qué "debe" hacer) y no se dirige a la persona, se
 *     descarta. Una señal fuerte basta; de las débiles hacen falta dos.
 */

const THINKING_TAGS = ['pensamiento', 'razonamiento', 'think', 'thinking', 'analysis', 'análisis', 'reasoning'];

const THINKING_BLOCK_RE = new RegExp(
  `<\\s*(${THINKING_TAGS.join('|')})\\s*>[\\s\\S]*?(?:<\\s*/\\s*\\1\\s*>|$)`,
  'gi',
);

/** Quita los bloques de razonamiento (cerrados o sin cerrar) que el modelo haya escrito. */
export function stripThinkingBlocks(text: string): string {
  return text.replace(THINKING_BLOCK_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Señales casi inequívocas de deliberación interna. */
const STRONG_SIGNALS: RegExp[] = [
  /\bno puedo asumir\b/iu,
  /\b(?:debo|no debo|tampoco debo|debería|no debería|tengo que)\s+(?:preguntar|ofrecer|responder|reconducir|evitar|mantener|asumir|insistir|confirmar|mencionar|recomendar|continuar)/iu,
  /\bvoy a (?:reconducir|mantener|evitar|aplicar|cualificar|redirigir|derivar|cerrar la conversación|seguir la regla)\b/iu,
  /\b(?:el|al|del|este|ese) (?:lead|usuario|prospecto|cliente potencial)\b/iu,
  /\b(?:la instrucción|las instrucciones|las reglas|la regla|el prompt|mi respuesta|mi objetivo (?:es|aquí)|según (?:las reglas|la regla|mis instrucciones))\b/iu,
  /\bsin ofrecer (?:la )?llamada\b/iu,
  /\bes ambiguo\b/iu,
  /\b(?:no )?(?:está|esta|queda) cualificad[oa]\b/iu,
  /\bno cumple (?:el|los|la|las|con)\b/iu,
];

/** Señales que por sí solas podrían ser legítimas (p.ej. tratando de usted). */
const WEAK_SIGNALS: RegExp[] = [
  // preguntarle, ofrecerle, responderle, decirle, recomendarle, pasarle…
  /\b(?:preguntar|ofrecer|responder|decir|recomendar|mandar|pasar|explicar|contar|proponer|sugerir|cualificar|reconducir|redirigir|derivar|agendar|confirmar)le\b/iu,
  /\ble (?:recomiendo|ofrezco|pregunto|respondo|digo|propongo|sugiero|explico|derivo|redirijo|agendo|paso|mando|cuento)\b/iu,
  /\b(?:el|la) (?:lead|persona|usuario|contacto) (?:tiene|dice|quiere|busca|no|ya|está|parece|responde|menciona)\b/iu,
  /\b(?:tiene|con) (?:0|cero|poco|muy poco|menos de \d)/iu,
  /\bno va a poder\b/iu,
  /\bhoy es (?:el )?\d/iu,
  /\bdentro de los \d+ días\b/iu,
  /\b(?:puede significar|literalmente|exactos)\b/iu,
];

/**
 * Señales de que el texto SÍ va dirigido a la persona (tú/usted, vocativos de
 * chat). Si aparecen, el globo se considera legítimo.
 */
const ADDRESSED_RE = new RegExp(
  [
    String.raw`\b(?:te|tú|tu|tus|ti|contigo|vosotros|vuestr[oa]s?|os|usted|ustedes)\b`,
    String.raw`\b(?:tienes|puedes|quieres|sabes|eres|estás|estas|vienes|necesitas|buscas|prefieres|dime|cuéntame|cuentame|mira|oye|vale|buenas|hola|gracias|perdona|imagina|piensa)\b`,
    // decirte, ayudarte, contarte, pasarte… / pasaros
    String.raw`\b[a-záéíóú]+(?:ar|er|ir)(?:te|os)\b`,
    // Trato de usted: "le viene bien", "le parece", "le interesa"…
    String.raw`\ble (?:viene|parece|interesa|gustaría|encaja|cuadra|va bien|vendría|apetece|ayudo)\b`,
    String.raw`\b(?:qué tal|cómo lo ves|cómo vas|te parece|te viene|te cuadra|te encaja)\b`,
  ].join('|'),
  'iu',
);

/** ¿Parece razonamiento interno del modelo en vez de un mensaje para la persona? */
export function looksLikeInternalReasoning(bubble: string): boolean {
  const text = bubble.trim();
  if (!text) return false;
  const strong = STRONG_SIGNALS.some((re) => re.test(text));
  const weak = WEAK_SIGNALS.filter((re) => re.test(text)).length;
  if (!strong && weak < 2) return false;
  return !ADDRESSED_RE.test(text);
}

/**
 * Filtra los globos que parecen razonamiento interno. Devuelve los globos que
 * quedan y los descartados (para registrarlos).
 */
export function dropInternalReasoning(bubbles: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const b of bubbles) (looksLikeInternalReasoning(b) ? dropped : kept).push(b);
  return { kept, dropped };
}
