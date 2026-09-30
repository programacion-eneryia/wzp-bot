/**
 * Etapas del pipeline. Las de sistema tienen una `key` fija de la que depende
 * el código (estadísticas, webhooks de cita, detección de agenda…); el cliente
 * puede renombrarlas/recolorearlas/reordenarlas pero no borrarlas. Las que crea
 * el cliente llevan una key slug generada a partir del nombre.
 */
export const SYSTEM_STAGE_KEYS = [
  'new',
  'qualifying',
  'qualified',
  'calendar_sent',
  'call_scheduled',
  'won',
  'not_qualified',
  'lost',
] as const;

export type SystemStageKey = (typeof SYSTEM_STAGE_KEYS)[number];

/** Etiquetas por defecto (en español) de las etapas de sistema. */
export const SYSTEM_STAGE_LABELS: Record<SystemStageKey, string> = {
  new: 'Nuevo',
  qualifying: 'Cualificando',
  qualified: 'Cualificado',
  calendar_sent: 'Calendario enviado',
  call_scheduled: 'Llamada agendada',
  won: 'Ganado',
  not_qualified: 'No cualificado',
  lost: 'Perdido',
};

export type PipelineStage = {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};
