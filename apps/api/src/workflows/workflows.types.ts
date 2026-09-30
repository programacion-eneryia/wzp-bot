/**
 * Tipos del árbol de workflows (formato compatible con React Flow en el front).
 * La definición se guarda como JSON en `workflows.definition`.
 */

export type WorkflowTrigger = 'lead_created' | 'conversation_created' | 'manual' | 'stage';

export type NodeType =
  | 'start'
  | 'message'
  | 'wait'
  | 'if_replied'
  | 'if_stage'
  | 'stop'
  | 'ai_handoff'
  | 'webhook';

export type WaitUnit = 'minutes' | 'hours' | 'days';

/** Datos específicos de cada nodo (según su tipo). */
export type WorkflowNodeData = {
  /** message: texto a enviar (admite variables {{name}} / {name}). */
  text?: string;
  /** wait: cantidad + unidad de espera. */
  amount?: number;
  unit?: WaitUnit;
  /** if_stage: estado con el que comparar. */
  stage?: string;
  /** stop: cambiar de estado y/o pausar seguimientos al terminar. */
  set_stage?: string;
  pause_followups?: boolean;
  /** webhook: URL de salida (https) y cuerpo opcional (JSON con variables). */
  url?: string;
  body?: string;
  /** webhook: método HTTP (por defecto POST). */
  method?: 'POST' | 'GET' | 'PUT' | 'PATCH';
  /** webhook: headers extra como JSON (`{"x-api-key": "..."}`, admite variables). */
  headers?: string;
  /** webhook: si se define, se envía como `Authorization: Bearer <token>`. */
  auth_token?: string;
  label?: string;
};

export type WorkflowNode = {
  id: string;
  type: NodeType;
  data?: WorkflowNodeData;
  position?: { x: number; y: number };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  /** Rama de salida en nodos condicionales: 'yes' | 'no' (u otra etiqueta). */
  sourceHandle?: string | null;
};

export type WorkflowDefinition = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
