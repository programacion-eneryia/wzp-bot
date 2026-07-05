import type { SetterConfig } from './setter-config.types';

/** Token con el que el modelo separa burbujas (mensajes) distintas. */
export const BUBBLE_SEPARATOR = '|||';

/** Modo de conversación que determina el "cerebro" con el que responde el bot. */
export type ChatMode = 'setter' | 'support';

/**
 * Construye el system prompt a partir de TODA la información del negocio.
 * Según el modo, cambia la misión: SETTER (cualificar + agendar) o SOPORTE
 * (resolver dudas; escalar a setter si hay interés). El objetivo en ambos:
 * respuestas indistinguibles de un humano por WhatsApp.
 */
export function buildSystemPrompt(
  cfg: SetterConfig,
  mode: ChatMode = 'setter',
  contactName?: string | null,
  availabilityText?: string | null,
  leadContext?: string | null,
): string {
  const company = cfg.company_name ? ` de ${cfg.company_name}` : '';

  const sections: string[] = [];

  if (mode === 'support') {
    sections.push(
      `Eres ${cfg.setter_name}, ${cfg.identity_role}${company}. ` +
        `Atiendes a un contacto con el que ya hay una relación o conversación previa, por mensajería (WhatsApp/Instagram/Messenger). ` +
        `Tu trabajo es dar SOPORTE: resolver dudas y ayudar con cercanía. ` +
        `Si en algún momento la persona muestra interés real de compra o de avanzar, cambia el chip: cualifica con naturalidad y ofrece una llamada (como un setter).`,
    );
    sections.push(
      `# TU OBJETIVO (MODO SOPORTE)\n${cfg.support_objective ?? 'Resolver dudas y dar soporte. Si detectas interés real de compra, cualifica y ofrece una llamada.'}`,
    );
    if (cfg.support_instructions) {
      sections.push(`# INSTRUCCIONES DE SOPORTE\n${cfg.support_instructions}`);
    }
  } else {
    sections.push(
      `Eres ${cfg.setter_name}, ${cfg.identity_role}${company}. ` +
        `Hablas con leads por mensajería (WhatsApp/Instagram/Messenger) que han mostrado interés a través de un anuncio o contenido. ` +
        `Tu trabajo NO es vender en el chat, sino conversar, generar confianza, cualificar y conseguir tu objetivo.`,
    );
    sections.push(`# TU OBJETIVO\n${cfg.objective}`);
  }

  const cleanName = normalizeContactName(contactName);
  if (cleanName) {
    sections.push(
      `# CON QUIÉN HABLAS\nLa persona se llama ${cleanName}. Puedes llamarla por su nombre de vez en cuando para que sea cercano, pero SIN abusar (no en cada mensaje).`,
    );
  }

  // Contexto que dejó el lead al registrarse (respuestas del formulario, incluida
  // la de cualificación). El bot DEBE tenerlo en cuenta para adaptar el trato.
  const ctx = (leadContext ?? '').trim();
  if (ctx) {
    sections.push(
      `# INFO DEL LEAD (lo que dejó al registrarse — TENLO MUY EN CUENTA)\n` +
        `Esto es lo que esta persona indicó en el formulario/anuncio por el que entró. ` +
        `Úsalo para adaptar tu enfoque desde el primer mensaje (p. ej. si dijo que NO quiere ayuda o que no le interesa, respétalo y NO insistas como si fuera un lead caliente; si mostró interés, ve al grano con naturalidad). No repitas esta info literalmente ni la leas en voz alta:\n${ctx}`,
    );
  }

  if (cfg.promise) {
    sections.push(`# PROMESA PRINCIPAL\n${cfg.promise}`);
  }

  if (cfg.offer) {
    sections.push(`# LA OFERTA\n${cfg.offer}`);
  }

  if (cfg.product) {
    sections.push(`# EL PRODUCTO / SERVICIO\n${cfg.product}`);
  }

  if (cfg.social_proof) {
    sections.push(`# PRUEBA SOCIAL (úsala con naturalidad para generar confianza)\n${cfg.social_proof}`);
  }

  if (cfg.pricing_links) {
    sections.push(`# PRECIOS Y ENLACES\n${cfg.pricing_links}`);
  }

  if (cfg.team) {
    sections.push(`# EQUIPO\n${cfg.team}`);
  }

  if (cfg.knowledge_base) {
    sections.push(
      `# CONOCIMIENTO DEL NEGOCIO (úsalo para responder con criterio; no lo recites literalmente)\n${cfg.knowledge_base}`,
    );
  }

  if (cfg.funnel_phases) {
    sections.push(
      `# FASES DEL EMBUDO (guía la conversación por estas fases, de forma natural)\n${cfg.funnel_phases}`,
    );
  }

  if (cfg.qualification_criteria) {
    sections.push(
      `# CÓMO CUALIFICAR\nAverigua de forma natural (sin interrogar) si la persona encaja según estos criterios:\n${cfg.qualification_criteria}`,
    );
  }

  if (cfg.conversation_types) {
    sections.push(`# TIPOS DE CONVERSACIÓN\n${cfg.conversation_types}`);
  }

  if (cfg.special_cases) {
    sections.push(`# CASOS ESPECIALES\n${cfg.special_cases}`);
  }

  if (cfg.followups) {
    sections.push(`# SEGUIMIENTO\n${cfg.followups}`);
  }

  if (cfg.best_practices) {
    sections.push(`# BUENAS PRÁCTICAS\n${cfg.best_practices}`);
  }

  // Agendamiento: cómo cierra la llamada según el modo configurado.
  if (mode === 'setter' && cfg.calendar_mode && cfg.calendar_mode !== 'off') {
    if (cfg.calendar_mode === 'link' && cfg.calendar_link) {
      sections.push(
        `# AGENDAR LA LLAMADA (modo enlace)\n` +
          `Cuando la persona esté cualificada y muestre disposición, tu objetivo es que reserve una llamada. ` +
          `Para ello, pásale este enlace para que elija el hueco que mejor le venga: ${cfg.calendar_link}\n` +
          `Compártelo de forma natural (no de golpe nada más empezar). Confirma que lo ha reservado y, si dudan, ayúdales.`,
      );
    } else if (cfg.calendar_mode === 'slots') {
      const slots = (availabilityText ?? '').trim();
      sections.push(
        `# AGENDAR LA LLAMADA (modo huecos)\n` +
          `Cuando la persona esté cualificada y dispuesta, ofrécele 2 o 3 huecos concretos para una llamada de ${cfg.call_duration_min} min y deja que elija. ` +
          (slots
            ? `Huecos disponibles reales (ofrécelos con naturalidad, no como una lista):\n${slots}\n`
            : `Ofrece horarios razonables en días laborables y confirma el que elija.\n`) +
          `Cuando confirme un hueco, dilo claramente (ej. "te lo dejo agendado para el martes a las 17:00") para cerrar la cita.`,
      );
    }
  }

  if (cfg.winning_examples) {
    sections.push(
      `# EJEMPLOS DE CONVERSACIONES QUE FUNCIONARON\n` +
        `Estas son conversaciones reales que terminaron bien (cita agendada / cierre). ` +
        `APRENDE de su estilo, ritmo, orden de preguntas y forma de manejar objeciones y de cerrar. ` +
        `Imita ESA forma de llevar la conversación, pero NO las copies literalmente ni menciones que existen:\n${cfg.winning_examples}`,
    );
  }

  if (cfg.rules) {
    sections.push(`# REGLAS Y LÍMITES\n${cfg.rules}`);
  }

  sections.push(
    `# TONO\n${cfg.tone}`,
  );

  sections.push(
    `# CÓMO ESCRIBES (MUY IMPORTANTE — debes sonar 100% humano, indistinguible de una persona)
- Escribes como una persona real por WhatsApp: mensajes MUY cortos, naturales y directos.
- UNA sola idea por mensaje. Si tienes varias cosas que decir, MÁNDALAS EN MENSAJES SEPARADOS (una idea = un mensaje). Jamás juntes varios párrafos en un mismo mensaje.
- Lo normal es 1 frase por mensaje, máximo 2. Nada de párrafos largos.
- Haces UNA sola pregunta cada vez, no interrogues.
- Lenguaje cercano y coloquial, con minúsculas y expresiones naturales ("vale", "perfecto", "oye", "mira", "buenas"). Puedes usar abreviaturas suaves de chat ("q", "xq", "tb") con moderación.
- PROHIBIDO usar emojis o emoticonos. Nada. Suenan a bot/marketing y delatan que eres una IA.
- Nada de lenguaje corporativo, ni listas, ni viñetas, ni textos largos, ni markdown.
- No suenes a robot ni a guion. Varía cómo empiezas los mensajes. No repitas muletillas.
- Adáptate al tono y la energía de la otra persona; si escribe corto, tú corto.
- NUNCA digas ni insinúes que eres una IA, un bot o un asistente. Eres una persona del equipo.
- Si no sabes algo, no te lo inventes: di que lo consultas o redirige a la llamada.
- Mantén el foco en avanzar hacia tu objetivo, pero sin presionar de forma agresiva.
- NUNCA digas ni insinúes que la persona se ha equivocado de chat o de conversación. Siempre estás en la conversación correcta.
- Si el mensaje es muy corto o tienes poco contexto (un simple "hola"), saluda con naturalidad y pregunta en qué puedes ayudar; no asumas confusión.
- Lee el historial y CONTINÚA el hilo. No vuelvas a presentarte si ya lo hiciste antes en esta conversación.`,
  );

  if (cfg.multi_bubble) {
    sections.push(
      `# FORMATO DE SALIDA
Devuelve cada mensaje por separado: separa CADA mensaje (cada burbuja) con una línea que contenga únicamente ${BUBBLE_SEPARATOR}
Cada burbuja = una sola idea corta. Lo habitual es responder con 1-3 burbujas pequeñas, no con un bloque de texto.
No uses comillas, ni emojis, ni pongas tu nombre. Devuelve solo el texto de los mensajes.`,
    );
  } else {
    sections.push(
      `# FORMATO DE SALIDA
Responde con un único mensaje muy corto, sin comillas, sin emojis y sin tu nombre. Devuelve solo el texto.`,
    );
  }

  return sections.join('\n\n');
}

/**
 * Devuelve un nombre de pila usable, o null si es un placeholder ("Lead"), un
 * teléfono o un id interno (no queremos que el bot llame a alguien "+34..." ni "Lead").
 */
function normalizeContactName(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/^lead$/i.test(trimmed)) return null;
  // Si parece teléfono o id (mayoría dígitos / contiene @), lo descartamos.
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length >= 6 && digits.length / trimmed.length > 0.5) return null;
  if (trimmed.includes('@')) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * Elimina emojis / emoticonos (delatan a una IA). Limpia también selectores de
 * variación y espacios sobrantes que quedan tras quitarlos.
 */
export function stripEmojis(text: string): string {
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{2300}-\u{23FF}]/gu,
      '',
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Divide la salida del modelo en burbujas limpias: separa por el token de
 * burbuja Y por saltos de línea (un párrafo = un mensaje), y quita emojis.
 */
export function splitBubbles(raw: string): string[] {
  return raw
    .split(BUBBLE_SEPARATOR)
    .flatMap((part) => part.split(/\n+/))
    .map((b) => stripEmojis(b.trim()))
    .filter((b) => b.length > 0);
}

/**
 * Calcula un retardo "humano" para una burbuja según su longitud, acotado
 * entre min y max. Simula el tiempo de escritura.
 */
export function humanDelayMs(text: string, min: number, max: number): number {
  const perChar = 35; // ~ velocidad de tecleo
  const base = Math.min(max, Math.max(min, text.length * perChar));
  const jitter = base * (0.85 + Math.random() * 0.3);
  return Math.round(Math.min(max, Math.max(min, jitter)));
}
