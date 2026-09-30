import { SYSTEM_STAGE_KEYS } from '../stages/stages.types';

/**
 * Etapas de sistema (las que el código conoce). El pipeline real de cada
 * organización es editable (`pipeline_stages`), así que `FunnelStage` es un
 * string: cualquier key del pipeline de la org.
 */
export const FUNNEL_STAGES = SYSTEM_STAGE_KEYS;

export type FunnelStage = string;

export type TagDefinition = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  description: string | null;
  set_stage: FunnelStage | null;
  ai_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** Etiqueta aplicada a una conversación, con datos de la definición para pintar. */
export type AppliedTag = {
  tag_id: string;
  name: string;
  color: string;
  source: 'ai' | 'human';
  created_at: string;
};
