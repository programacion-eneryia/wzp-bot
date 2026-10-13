export type AgentKind = 'setter' | 'support' | 'custom';

export type Agent = {
  id: string;
  organization_id: string;
  name: string;
  kind: AgentKind;
  is_active: boolean;
  uses_stages: boolean;

  persona_name: string;
  identity_role: string;
  objective: string;
  tone: string;
  rules: string | null;
  instructions: string | null;
  qualification_criteria: string | null;
  funnel_phases: string | null;
  conversation_types: string | null;
  special_cases: string | null;
  followups: string | null;
  best_practices: string | null;
  winning_examples: string | null;

  calendar_mode: 'off' | 'slots' | 'link';
  calendar_link: string | null;
  call_duration_min: number;
  default_calendar_id: string | null;

  model: string | null;
  sort_order: number;

  /** Pipeline cuyas etapas usa el agente (null = sin embudo). */
  pipeline_id: string | null;
  /** Se activa solo con los leads que entran (formulario, GHL, webhook). */
  is_default_lead: boolean;
  /** Se activa solo con las conversaciones nuevas que llegan por los canales. */
  is_default_conversation: boolean;
  /** Ajustes de IA propios; null = hereda los generales de la cuenta. */
  behavior: AgentBehavior | null;

  created_at: string;
  updated_at: string;
};

/** Ajustes de comportamiento que un agente puede sobreescribir. */
export type AgentBehavior = {
  multi_bubble?: boolean;
  first_reply_min_s?: number;
  first_reply_max_s?: number;
  min_delay_ms?: number;
  max_delay_ms?: number;
  active_hours_enabled?: boolean;
  active_hours_start?: number;
  active_hours_end?: number;
  timezone?: string;
};

export const BEHAVIOR_KEYS: (keyof AgentBehavior)[] = [
  'multi_bubble',
  'first_reply_min_s',
  'first_reply_max_s',
  'min_delay_ms',
  'max_delay_ms',
  'active_hours_enabled',
  'active_hours_start',
  'active_hours_end',
  'timezone',
];

/**
 * Ajustes efectivos: los generales de la cuenta con los del agente encima.
 * Genérico para no acoplar este módulo al tipo de setter_configs.
 */
export function effectiveBehavior<T extends object>(cfg: T, agent: Pick<Agent, 'behavior'> | null): T {
  const b = agent?.behavior;
  if (!b) return cfg;
  const out = { ...cfg } as Record<string, unknown>;
  for (const k of BEHAVIOR_KEYS) {
    if (b[k] !== undefined && b[k] !== null) out[k] = b[k];
  }
  return out as T;
}

/** Campos editables por el cliente. */
export type AgentInput = Partial<
  Omit<Agent, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
>;

/** Quién atiende y cómo arranca una conversación/lead recién creado. */
export type InitialAssignment = {
  agent: Agent | null;
  /** IA encendida solo si hay un agente predeterminado (o elegido) activo. */
  ai_enabled: boolean;
  /** Primera etapa del pipeline del agente (o 'new'). */
  stage: string;
  /** agent_id a guardar en la conversación (null = lo resuelve el canal). */
  agent_id: string | null;
};

/** Agente con los canales que tiene asignados (para la lista del panel). */
export type AgentWithChannels = Agent & {
  channels: Array<{ id: string; provider: string; display_name: string | null }>;
};

/** Plantillas para "nuevo agente". */
export const AGENT_TEMPLATES: Record<AgentKind, AgentInput> = {
  setter: {
    name: 'Setter',
    kind: 'setter',
    uses_stages: true,
    persona_name: 'Alex',
    identity_role: 'Setter del equipo comercial',
    objective: 'Cualificar al lead y agendar una llamada con un closer.',
    tone: 'Cercano, humano, profesional. Tutea. Mensajes cortos.',
  },
  support: {
    name: 'Soporte',
    kind: 'support',
    uses_stages: true,
    persona_name: 'Alex',
    identity_role: 'Atención al cliente',
    objective:
      'Resolver dudas y dar soporte de forma cercana. Si detectas interés real de compra, cualifica con naturalidad y ofrece una llamada.',
    tone: 'Cercano, humano, resolutivo. Tutea. Mensajes cortos.',
  },
  custom: {
    name: 'Nuevo agente',
    kind: 'custom',
    uses_stages: true,
    persona_name: 'Alex',
    identity_role: 'Miembro del equipo',
    objective: 'Describe aquí qué debe conseguir este agente en la conversación.',
    tone: 'Cercano, humano, profesional. Tutea. Mensajes cortos.',
  },
};
