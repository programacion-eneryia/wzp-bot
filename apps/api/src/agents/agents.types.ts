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
  created_at: string;
  updated_at: string;
};

/** Campos editables por el cliente. */
export type AgentInput = Partial<
  Omit<Agent, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
>;

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
    uses_stages: false,
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
