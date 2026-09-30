import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from '../openrouter/openrouter.service';
import type { GeneratedSetterFields } from './setter-config.types';

/** Campos que van a la Base de Conocimiento (comunes a todos los agentes). */
export const BUSINESS_FIELDS: (keyof GeneratedSetterFields)[] = [
  'company_name',
  'summary',
  'promise',
  'offer',
  'product',
  'social_proof',
  'pricing_links',
  'team',
];

/** Campos que definen al agente SETTER (conversación de venta). */
export const SETTER_AGENT_FIELDS: (keyof GeneratedSetterFields)[] = [
  'setter_name',
  'identity_role',
  'objective',
  'qualification_criteria',
  'funnel_phases',
  'conversation_types',
  'special_cases',
  'followups',
  'best_practices',
  'tone',
  'rules',
];

const FIELDS: (keyof GeneratedSetterFields)[] = [...BUSINESS_FIELDS, ...SETTER_AGENT_FIELDS];

export type GeneratedBrief = {
  /** Campos de negocio + setter (compatibilidad con la UI anterior). */
  fields: GeneratedSetterFields;
  /** Cerebro del agente de soporte. */
  support: { objective?: string; instructions?: string };
  /** Etiquetas sugeridas por la IA a partir del brief. */
  suggested_tags: Array<{ name: string; description: string }>;
  /** Etapas del pipeline sugeridas (además de las de sistema). */
  suggested_stages: string[];
};

@Injectable()
export class SetterAssistantService {
  private readonly logger = new Logger(SetterAssistantService.name);

  constructor(
    private readonly openrouter: OpenRouterService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A partir del brief del negocio, genera la configuración COMPLETA: la Base
   * de Conocimiento (negocio), el agente Setter, el agente de Soporte y
   * sugerencias de etiquetas y etapas del pipeline.
   */
  async generateFromBrief(brief: string, orgId?: string): Promise<GeneratedBrief> {
    const system = `Eres un experto en montar agentes de IA conversacionales (setters y soporte) para captar y cualificar leads por WhatsApp/Instagram y agendar llamadas.
A partir del brief de un negocio, diseñas la configuración completa.

Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto antes ni después, sin markdown) con estas claves (todas en español):

# CONTEXTO DEL NEGOCIO (común a todos los agentes)
- company_name: nombre de la empresa si se deduce, si no "".
- summary: 2-3 frases que resuman el negocio y a quién ayuda.
- promise: la promesa/transformación principal de la oferta.
- offer: la oferta principal, clara y concreta.
- product: en qué consiste el producto/servicio.
- social_proof: pruebas sociales, casos de éxito o resultados (si no hay, "").
- pricing_links: precios y enlaces relevantes (si no hay, "").
- team: el equipo (si no hay, "").

# AGENTE SETTER (conversación comercial)
- setter_name: nombre humano y creíble para el setter (ej. "Alex", "Marta").
- identity_role: quién es y su rol (ej. "consultor del equipo de X").
- objective: el objetivo del setter (normalmente cualificar y agendar llamada).
- qualification_criteria: criterios para saber si un lead encaja (en líneas con "- ").
- funnel_phases: las fases del embudo paso a paso (apertura, cualificar, generar interés, cierre hacia la llamada...).
- conversation_types: tipos de conversación / situaciones que puede encontrarse.
- special_cases: casos especiales y cómo actuar.
- followups: estrategia de seguimiento si el lead no responde.
- best_practices: buenas prácticas de conversación.
- tone: el tono y estilo (humano, cercano, WhatsApp, sin tecnicismos).
- rules: reglas y límites (qué NO hacer; ej. no dar precios por chat, no presionar, no usar emojis, no sonar a robot).

# AGENTE DE SOPORTE (clientes / dudas)
- support_objective: objetivo del agente de soporte (resolver dudas de clientes y contactos existentes; si detecta interés de compra, cualificar y ofrecer llamada).
- support_instructions: instrucciones concretas de soporte según el brief (preguntas frecuentes, qué derivar a una persona, horarios, políticas). Si el brief no habla de soporte, deduce lo razonable.

# ETIQUETAS Y ETAPAS
- suggested_tags: array de 3 a 8 objetos {"name": "...", "description": "..."} con etiquetas útiles para clasificar conversaciones de ESTE negocio (interés en X, objeción precio, pide info, no es el público, etc.). "description" = cuándo debe aplicarla la IA. Nombres cortos (máx 30 caracteres).
- suggested_stages: array de 0 a 4 strings con etapas del pipeline ESPECÍFICAS de este negocio que NO estén ya cubiertas por: Nuevo, Cualificando, Cualificado, Calendario enviado, Llamada agendada, Ganado, No cualificado, Perdido. Si no hace falta ninguna, devuelve [].

Reglas de estilo para los textos: pensados para que el agente suene 100% humano por WhatsApp (mensajes cortos, sin emojis, una idea por mensaje). Sé concreto y útil, nada de relleno.
IMPORTANTE: cada valor debe ser BREVE (1-4 frases por campo; las listas como pocas líneas con "- "). No te extiendas, para que quepa todo el JSON.`;

    const trimmed = brief.slice(0, 28000);

    const raw = await this.openrouter.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: `BRIEF DEL NEGOCIO:\n\n${trimmed}` },
      ],
      {
        model: this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ?? undefined,
        temperature: 0.6,
        maxTokens: 7000,
        orgId,
        purpose: 'generate',
      },
    );

    const parsed = extractJson(raw);
    if (!parsed) {
      this.logger.error(
        `JSON inválido de la IA (len=${raw.length}). Inicio: ${raw.slice(0, 200)} | Fin: ${raw.slice(-200)}`,
      );
      throw new HttpException('La IA no devolvió una configuración válida', 502);
    }

    // Nos quedamos solo con las claves conocidas y como strings.
    const fields: GeneratedSetterFields = {};
    for (const key of FIELDS) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        fields[key] = value.trim();
      }
    }

    const support: GeneratedBrief['support'] = {};
    if (typeof parsed.support_objective === 'string' && parsed.support_objective.trim()) {
      support.objective = parsed.support_objective.trim();
    }
    if (typeof parsed.support_instructions === 'string' && parsed.support_instructions.trim()) {
      support.instructions = parsed.support_instructions.trim();
    }

    const suggested_tags: GeneratedBrief['suggested_tags'] = [];
    if (Array.isArray(parsed.suggested_tags)) {
      for (const t of parsed.suggested_tags as unknown[]) {
        if (!t || typeof t !== 'object') continue;
        const o = t as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : '';
        const description = typeof o.description === 'string' ? o.description.trim().slice(0, 600) : '';
        if (name) suggested_tags.push({ name, description });
        if (suggested_tags.length >= 8) break;
      }
    }

    const suggested_stages: string[] = [];
    if (Array.isArray(parsed.suggested_stages)) {
      for (const s of parsed.suggested_stages as unknown[]) {
        if (typeof s === 'string' && s.trim()) suggested_stages.push(s.trim().slice(0, 60));
        if (suggested_stages.length >= 4) break;
      }
    }

    return { fields, support, suggested_tags, suggested_stages };
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
