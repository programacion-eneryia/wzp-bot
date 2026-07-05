export type SetterConfig = {
  organization_id: string;
  setter_name: string;
  identity_role: string;
  company_name: string | null;
  offer: string | null;
  knowledge_base: string | null;
  objective: string;
  qualification_criteria: string | null;
  tone: string;
  rules: string | null;

  // Contexto rico del negocio
  summary: string | null;
  promise: string | null;
  funnel_phases: string | null;
  conversation_types: string | null;
  best_practices: string | null;
  product: string | null;
  team: string | null;
  social_proof: string | null;
  pricing_links: string | null;
  special_cases: string | null;
  followups: string | null;

  // Cerebro de Soporte (modo support) + proactivo
  support_enabled: boolean;
  support_objective: string | null;
  support_instructions: string | null;
  proactive_template: string | null;

  // Aprendizaje por ejemplos (conversaciones que funcionaron)
  winning_examples: string | null;

  // Agendamiento
  calendar_mode: 'off' | 'slots' | 'link';
  calendar_link: string | null;
  call_duration_min: number;
  default_calendar_id: string | null;

  // Humanización / salida
  multi_bubble: boolean;
  min_delay_ms: number;
  max_delay_ms: number;

  // Ajustes de comportamiento de la IA
  first_reply_min_s: number;
  first_reply_max_s: number;
  typing_cps: number;
  active_hours_enabled: boolean;
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  ignore_followed: boolean;

  // LLM
  model: string | null;
  language: string;
  is_active: boolean;
  // Control de coste: tope de tokens de IA por día y organización (0 = ilimitado).
  daily_token_limit: number;
  updated_at?: string;
};

/** Campos de contexto que la IA puede generar a partir del brief. */
export type GeneratedSetterFields = Partial<
  Pick<
    SetterConfig,
    | 'setter_name'
    | 'identity_role'
    | 'company_name'
    | 'offer'
    | 'objective'
    | 'qualification_criteria'
    | 'tone'
    | 'rules'
    | 'summary'
    | 'promise'
    | 'funnel_phases'
    | 'conversation_types'
    | 'best_practices'
    | 'product'
    | 'team'
    | 'social_proof'
    | 'pricing_links'
    | 'special_cases'
    | 'followups'
  >
>;
