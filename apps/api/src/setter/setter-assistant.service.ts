import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from '../openrouter/openrouter.service';
import type { GeneratedSetterFields } from './setter-config.types';

const FIELDS: (keyof GeneratedSetterFields)[] = [
  'setter_name',
  'identity_role',
  'company_name',
  'summary',
  'promise',
  'offer',
  'product',
  'social_proof',
  'pricing_links',
  'team',
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

@Injectable()
export class SetterAssistantService {
  private readonly logger = new Logger(SetterAssistantService.name);

  constructor(
    private readonly openrouter: OpenRouterService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A partir del brief del negocio, genera una configuración COMPLETA del setter
   * (identidad, oferta, fases del embudo, cualificación, reglas, tono, etc.).
   */
  async generateFromBrief(brief: string): Promise<GeneratedSetterFields> {
    const system = `Eres un experto en montar "setters" de IA (closers conversacionales) para captar y cualificar leads por WhatsApp/Instagram y agendar llamadas.
A partir del brief de un negocio, diseñas la configuración del setter.

Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto antes ni después, sin markdown) con estas claves (todas en español):
- setter_name: nombre humano y creíble para el setter (ej. "Alex", "Marta").
- identity_role: quién es y su rol (ej. "consultor del equipo de X").
- company_name: nombre de la empresa si se deduce, si no "".
- summary: 2-3 frases que resuman al setter, su personalidad y objetivo.
- promise: la promesa/transformación principal de la oferta.
- offer: la oferta principal, clara y concreta.
- product: en qué consiste el producto/servicio.
- social_proof: pruebas sociales, casos de éxito o resultados (si no hay, "").
- pricing_links: precios y enlaces relevantes (si no hay, "").
- team: el equipo (si no hay, "").
- objective: el objetivo del setter (normalmente cualificar y agendar llamada).
- qualification_criteria: criterios para saber si un lead encaja (en líneas con "- ").
- funnel_phases: las fases del embudo paso a paso (apertura, cualificar, generar interés, cierre hacia la llamada...).
- conversation_types: tipos de conversación / situaciones que puede encontrarse.
- special_cases: casos especiales y cómo actuar.
- followups: estrategia de seguimiento si el lead no responde.
- best_practices: buenas prácticas de conversación.
- tone: el tono y estilo (humano, cercano, WhatsApp, sin tecnicismos).
- rules: reglas y límites (qué NO hacer; ej. no dar precios por chat, no presionar, no usar emojis, no sonar a robot).

Reglas de estilo para los textos: pensados para que el setter suene 100% humano por WhatsApp (mensajes cortos, sin emojis, una idea por mensaje). Sé concreto y útil, nada de relleno.
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
        maxTokens: 6000,
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
    const result: GeneratedSetterFields = {};
    for (const key of FIELDS) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        result[key] = value.trim();
      }
    }
    return result;
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
