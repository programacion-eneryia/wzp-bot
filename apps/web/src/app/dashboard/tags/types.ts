/** Key de una etapa del pipeline de la organización (editable en "Pipelines y Stages"). */
export type Stage = string;

export type Tag = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  set_stage: Stage | null;
  ai_enabled: boolean;
  sort_order: number;
};
