"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiFetch } from "@/lib/api";
import { useStages, type Pipeline } from "@/lib/stages";
import { useAgents } from "@/lib/agents";
import { type NodeKind, type Workflow } from "./types";
import styles from "./workflows.module.css";

type NodeData = {
  kind: NodeKind;
  text?: string;
  amount?: number;
  unit?: "minutes" | "hours" | "days";
  stage?: string;
  set_stage?: string;
  pause_followups?: boolean;
  url?: string;
  body?: string;
  method?: "POST" | "GET" | "PUT" | "PATCH";
  headers?: string;
  auth_token?: string;
  agent_id?: string;
};

const META: Record<NodeKind, { label: string; branch?: boolean; terminal?: boolean }> = {
  start: { label: "Inicio" },
  message: { label: "Enviar mensaje" },
  wait: { label: "Esperar" },
  wait_reply: { label: "Esperar respuesta", branch: true },
  if_replied: { label: "¿Respondió?", branch: true },
  if_stage: { label: "Según estado", branch: true },
  stop: { label: "Detener", terminal: true },
  ai_handoff: { label: "Pasar a IA", terminal: true },
  webhook: { label: "Enviar webhook" },
};

/** "¿Respondió?" ya no se ofrece: "Esperar respuesta" hace lo mismo con tiempo máximo. */
const PALETTE: NodeKind[] = [
  "message",
  "wait",
  "wait_reply",
  "if_stage",
  "webhook",
  "stop",
  "ai_handoff",
];

/** Variables disponibles para insertar en los mensajes. */
const VARIABLES: { value: string; label: string }[] = [
  { value: "name", label: "Nombre (pila)" },
  { value: "first_name", label: "Nombre (pila)" },
  { value: "full_name", label: "Nombre completo" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Teléfono" },
  { value: "source", label: "Fuente" },
  { value: "campaign", label: "Campaña" },
  { value: "stage", label: "Estado" },
];

const UNIT_LABEL: Record<NonNullable<NodeData["unit"]>, string> = {
  minutes: "min",
  hours: "h",
  days: "días",
};

const V_GAP_Y = 150;
const V_GAP_X = 220;

const isTerminal = (k: NodeKind) => META[k].terminal === true;
const isBranch = (k: NodeKind) => META[k].branch === true;

function summarize(d: NodeData, stageLabel: (k: string) => string = (k) => k): string {
  switch (d.kind) {
    case "message":
      return d.text ? (d.text.length > 60 ? d.text.slice(0, 60) + "…" : d.text) : "(sin texto)";
    case "wait":
      return `${d.amount ?? 0} ${UNIT_LABEL[d.unit ?? "minutes"]}`;
    case "wait_reply":
      return `máx. ${d.amount ?? 0} ${UNIT_LABEL[d.unit ?? "hours"]}`;
    case "if_replied":
      return "sí / no";
    case "if_stage":
      return d.stage ? `= ${stageLabel(d.stage)}` : "(elige estado)";
    case "stop":
      return [d.pause_followups ? "pausar" : null, d.set_stage ? `→ ${stageLabel(d.set_stage)}` : null]
        .filter(Boolean)
        .join(" · ") || "fin";
    case "ai_handoff":
      return "la IA responde";
    case "webhook":
      return d.url ? (d.url.length > 40 ? d.url.slice(0, 40) + "…" : d.url) : "(sin URL)";
    default:
      return "";
  }
}

type MenuAnchor = { source: string; handle: string | null; x: number; y: number; between: boolean };

/** Acciones del lienzo accesibles desde nodos y flechas personalizados. */
const FlowCtx = createContext<{
  edges: Edge[];
  openMenu: (anchor: MenuAnchor) => void;
} | null>(null);

function PlusButton({
  nodeId,
  handle,
  left,
}: {
  nodeId: string;
  handle: string | null;
  left: string;
}) {
  const ctx = useContext(FlowCtx);
  return (
    <button
      type="button"
      className={`${styles.nodePlus} nodrag nopan`}
      style={{ left }}
      title="Añadir un paso aquí"
      onClick={(e) => {
        e.stopPropagation();
        ctx?.openMenu({ source: nodeId, handle, x: e.clientX, y: e.clientY, between: false });
      }}
    >
      +
    </button>
  );
}

function WfNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  const meta = META[d.kind];
  const { label: stageLabel } = useStages();
  const { agents } = useAgents();
  const ctx = useContext(FlowCtx);
  const free = (h: string | null) =>
    !(ctx?.edges ?? []).some((e) => e.source === id && (e.sourceHandle ?? null) === h);
  const agentName =
    d.kind === "ai_handoff" && d.agent_id ? agents.find((a) => a.id === d.agent_id)?.name : null;
  return (
    <div className={`${styles.node} ${selected ? styles.nodeSel : ""}`} data-kind={d.kind}>
      {d.kind !== "start" && <Handle type="target" position={Position.Top} />}
      <div className={styles.nodeTitle}>{meta.label}</div>
      <div className={styles.nodeBody}>
        {agentName ? `responde ${agentName}` : summarize(d, stageLabel)}
      </div>
      {meta.branch ? (
        <>
          <Handle id="yes" type="source" position={Position.Bottom} style={{ left: "28%" }} />
          <Handle id="no" type="source" position={Position.Bottom} style={{ left: "72%" }} />
          <span className={styles.handleYes}>sí</span>
          <span className={styles.handleNo}>no</span>
          {free("yes") && <PlusButton nodeId={id} handle="yes" left="28%" />}
          {free("no") && <PlusButton nodeId={id} handle="no" left="72%" />}
        </>
      ) : (
        !meta.terminal && (
          <>
            <Handle type="source" position={Position.Bottom} />
            {free(null) && <PlusButton nodeId={id} handle={null} left="50%" />}
          </>
        )
      )}
    </div>
  );
}

/** Flecha con un "+" en medio para insertar un paso entre dos nodos. */
function PlusEdge({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  label,
}: EdgeProps) {
  const ctx = useContext(FlowCtx);
  const [path, lx, ly] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className={`${styles.edgeTools} nodrag nopan`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
        >
          {label && <span className={styles.edgeLabel}>{label}</span>}
          <button
            type="button"
            className={styles.edgePlus}
            title="Insertar un paso aquí"
            onClick={(e) => {
              e.stopPropagation();
              ctx?.openMenu({
                source,
                handle: sourceHandleId ?? null,
                x: e.clientX,
                y: e.clientY,
                between: true,
              });
            }}
          >
            +
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { wf: WfNode };
const edgeTypes = { plus: PlusEdge };

function mkEdge(source: string, target: string, handle: string | null): Edge {
  return {
    id: `e-${source}-${handle ?? "out"}-${target}`,
    source,
    target,
    sourceHandle: handle ?? undefined,
    type: "plus",
    markerEnd: { type: MarkerType.ArrowClosed },
    label: handle === "yes" ? "sí" : handle === "no" ? "no" : undefined,
  };
}

function defaultsFor(kind: NodeKind): NodeData {
  if (kind === "wait") return { kind, amount: 1, unit: "hours" };
  if (kind === "wait_reply") return { kind, amount: 24, unit: "hours" };
  if (kind === "message") return { kind, text: "" };
  if (kind === "webhook") return { kind, url: "", body: "" };
  return { kind };
}

/** Nodos alcanzables desde `fromId` (incluido) siguiendo las flechas. */
function reachable(fromId: string | undefined, edges: Edge[]): Set<string> {
  const seen = new Set<string>();
  if (!fromId) return seen;
  const stack = [fromId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.source === cur) stack.push(e.target);
  }
  return seen;
}

/** Nodo más abajo del lienzo (para encadenar nuevos nodos si no hay selección). */
function lowestNode(nodes: Node[]): Node | undefined {
  if (nodes.length === 0) return undefined;
  return nodes.reduce((a, b) => (b.position.y > a.position.y ? b : a));
}

/**
 * Handle libre del nodo de origen para auto-conectar:
 *   - null      → salida directa (nodos no condicionales), si está libre.
 *   - 'yes'/'no'→ rama libre en nodos condicionales.
 *   - undefined → no hay salida libre (no se auto-conecta).
 */
function freeHandle(anchor: Node, edges: Edge[]): string | null | undefined {
  const kind = (anchor.data as NodeData).kind;
  const has = (h: string | null) =>
    edges.some((e) => e.source === anchor.id && (e.sourceHandle ?? null) === h);
  if (isBranch(kind)) {
    if (!has("yes")) return "yes";
    if (!has("no")) return "no";
    return undefined;
  }
  return has(null) ? undefined : null;
}

function StageOptions({ pipelines }: { pipelines: Pipeline[] }) {
  if (pipelines.length <= 1) {
    return (
      <>
        {(pipelines[0]?.stages ?? []).map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </>
    );
  }
  return (
    <>
      {pipelines.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function defToFlow(wf: Workflow): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (wf.definition?.nodes ?? []).map((n, i) => ({
    id: n.id,
    type: "wf",
    position: n.position ?? { x: 250, y: 40 + i * 130 },
    data: { ...(n.data ?? {}), kind: n.type } as NodeData,
  }));
  const edges: Edge[] = (wf.definition?.edges ?? []).map((e) => ({
    ...mkEdge(e.source, e.target, e.sourceHandle ?? null),
    id: e.id,
  }));
  return { nodes, edges };
}

function Editor({ workflow, onBack }: { workflow: Workflow; onBack: () => void }) {
  const { pipelines } = useStages();
  const { agents } = useAgents();
  const initial = useMemo(() => defToFlow(workflow), [workflow]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(workflow.name);
  const [trigger, setTrigger] = useState(workflow.trigger);
  const [isActive, setIsActive] = useState(workflow.is_active);
  const [agentId, setAgentId] = useState<string>(workflow.agent_id ?? "");
  const [resumeHours, setResumeHours] = useState<string>(
    workflow.resume_after_hours ? String(workflow.resume_after_hours) : "",
  );
  const [triggerStage, setTriggerStage] = useState<string>(
    (workflow.trigger_config?.stage as string) ?? "qualified",
  );
  const [webhookUrl, setWebhookUrl] = useState<string | null>(workflow.webhook_url ?? null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  /**
   * Añade un paso tras la salida `handle` de `sourceId`. Si esa salida ya
   * apuntaba a otro paso, el nuevo se inserta en medio y lo de abajo baja.
   */
  function insertAfter(sourceId: string, handle: string | null, kind: NodeKind) {
    const src = nodes.find((n) => n.id === sourceId);
    if (!src) return;
    const existing = edges.find(
      (e) => e.source === sourceId && (e.sourceHandle ?? null) === handle,
    );
    if (existing && isTerminal(kind)) {
      setMsg(`"${META[kind].label}" termina el flujo: solo puede ir al final de una rama.`);
      return;
    }
    const id = crypto.randomUUID();
    const target = existing ? nodes.find((n) => n.id === existing.target) : undefined;
    const dx = handle === "no" ? V_GAP_X : handle === "yes" ? -V_GAP_X : 0;
    const position = target
      ? { x: target.position.x, y: target.position.y }
      : { x: src.position.x + dx, y: src.position.y + V_GAP_Y };
    const shift = target ? reachable(target.id, edges) : new Set<string>();

    setNodes((nds) => [
      ...nds.map((n) =>
        shift.has(n.id) ? { ...n, position: { ...n.position, y: n.position.y + V_GAP_Y } } : n,
      ),
      { id, type: "wf", position, data: defaultsFor(kind) },
    ]);
    setEdges((eds) => {
      const next = eds.filter((e) => e !== existing);
      next.push(mkEdge(sourceId, id, handle));
      if (existing) next.push(mkEdge(id, existing.target, isBranch(kind) ? "yes" : null));
      return next;
    });
    setSelected(id);
    setMenu(null);
  }

  /** Paleta lateral: añade tras el paso seleccionado (o el último de la cadena). */
  function addNode(kind: NodeKind) {
    const anchor = nodes.find((n) => n.id === selected) ?? lowestNode(nodes);
    if (!anchor) {
      const id = crypto.randomUUID();
      setNodes((nds) => [...nds, { id, type: "wf", position: { x: 250, y: 40 }, data: defaultsFor(kind) }]);
      setSelected(id);
      return;
    }
    const anchorKind = (anchor.data as NodeData).kind;
    if (isTerminal(anchorKind)) {
      setMsg(`"${META[anchorKind].label}" termina el flujo. Selecciona otro paso o usa el + de una flecha.`);
      return;
    }
    const free = freeHandle(anchor, edges);
    insertAfter(anchor.id, free === undefined ? (isBranch(anchorKind) ? "yes" : null) : free, kind);
  }

  function openMenu(anchor: MenuAnchor) {
    const rect = canvasRef.current?.getBoundingClientRect();
    setMenu(rect ? { ...anchor, x: anchor.x - rect.left, y: anchor.y - rect.top } : anchor);
  }

  /** Inserta una variable en el textarea del mensaje (en la posición del cursor). */
  function insertVariable(v: string) {
    if (!selected) return;
    const token = `{${v}}`;
    const el = textRef.current;
    const cur = (selData?.text as string) ?? "";
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    patchSelected({ text: next });
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function patchSelected(patch: Partial<NodeData>) {
    if (!selected) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selected ? { ...n, data: { ...(n.data as NodeData), ...patch } } : n)),
    );
  }

  /** Elimina el paso y vuelve a unir lo de arriba con lo de abajo. */
  function deleteSelected() {
    const node = nodes.find((n) => n.id === selected);
    if (!node || (node.data as NodeData).kind === "start") return;
    const incoming = edges.filter((e) => e.target === node.id);
    const outgoing = edges.filter((e) => e.source === node.id);
    const keep =
      outgoing.find((e) => (e.sourceHandle ?? null) === null) ??
      outgoing.find((e) => e.sourceHandle === "yes") ??
      outgoing[0];
    let nextEdges = edges.filter((e) => e.source !== node.id && e.target !== node.id);
    if (keep) {
      for (const inc of incoming) nextEdges.push(mkEdge(inc.source, keep.target, inc.sourceHandle ?? null));
    }
    let nextNodes = nodes.filter((n) => n.id !== node.id);

    // Si era una bifurcación, la otra rama queda colgando: se elimina con él.
    const startId = nodes.find((n) => (n.data as NodeData).kind === "start")?.id;
    const before = reachable(startId, edges);
    const after = reachable(startId, nextEdges);
    const lost = new Set(nextNodes.filter((n) => before.has(n.id) && !after.has(n.id)).map((n) => n.id));
    if (
      lost.size > 0 &&
      !confirm(`También se eliminará la otra rama de este paso (${lost.size} paso(s)). ¿Continuar?`)
    ) {
      return;
    }
    nextNodes = nextNodes.filter((n) => !lost.has(n.id));
    nextEdges = nextEdges.filter((e) => !lost.has(e.source) && !lost.has(e.target));
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelected(null);
  }

  async function rotateWebhook() {
    if (!confirm("Se generará una URL nueva y la anterior dejará de funcionar. ¿Continuar?")) return;
    try {
      const res = await apiFetch<Workflow>(`/api/workflows/${workflow.id}/webhook-token`, {
        method: "POST",
      });
      setWebhookUrl(res.webhook_url ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo regenerar la URL");
    }
  }

  function validate(): string | null {
    const emptyMsg = nodes.some(
      (n) => (n.data as NodeData).kind === "message" && !((n.data as NodeData).text ?? "").trim(),
    );
    if (emptyMsg) return "Hay un nodo de mensaje sin texto.";
    const targets = new Set(edges.map((e) => e.target));
    const orphans = nodes.filter(
      (n) => (n.data as NodeData).kind !== "start" && !targets.has(n.id),
    );
    if (orphans.length > 0) return `Hay ${orphans.length} nodo(s) sin conectar.`;
    return null;
  }

  async function save() {
    const warning = validate();
    if (warning && !confirm(`${warning}\n\n¿Guardar de todas formas?`)) return;
    setSaving(true);
    setMsg(null);
    try {
      const definition = {
        nodes: nodes.map((n) => {
          const d = n.data as NodeData;
          const { kind, ...rest } = d;
          return { id: n.id, type: kind, data: rest, position: n.position };
        }),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
        })),
      };
      const saved = await apiFetch<Workflow>(`/api/workflows/${workflow.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          trigger,
          trigger_config: trigger === "stage" ? { stage: triggerStage } : {},
          is_active: isActive,
          agent_id: agentId || null,
          resume_after_hours: resumeHours ? Number(resumeHours) : 0,
          definition,
        }),
      });
      setWebhookUrl(saved?.webhook_url ?? null);
      setMsg("Guardado");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const sel = nodes.find((n) => n.id === selected);
  const selData = sel?.data as NodeData | undefined;

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <button className={styles.ghostBtn} onClick={onBack}>
          ← Volver
        </button>
        <input
          className={styles.nameInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={styles.input}
          value={trigger}
          onChange={(e) => setTrigger(e.target.value as Workflow["trigger"])}
        >
          <option value="lead_created">Cuando entra un lead</option>
          <option value="conversation_created">Cuando entra una conversación nueva</option>
          <option value="manual">Manual</option>
          <option value="stage">Al cambiar de estado</option>
          <option value="webhook">Recibe un webhook</option>
        </select>
        {trigger === "stage" && (
          <select
            className={styles.input}
            value={triggerStage}
            onChange={(e) => setTriggerStage(e.target.value)}
          >
            <StageOptions pipelines={pipelines} />
          </select>
        )}
        {agents.length > 1 && (
          <select
            className={styles.input}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            title="Si eliges un agente, este workflow solo se dispara para conversaciones que atiende ese agente (y 'Pasar a IA' se la asigna)."
          >
            <option value="">Cualquier agente</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                Agente: {a.name}
              </option>
            ))}
          </select>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Activo
        </label>
        <label
          className={styles.resume}
          title="Cuando el lead responde, los seguimientos se pausan. Si vuelve a quedarse en silencio durante estas horas, el workflow se reanuda solo desde donde iba. Vacío = no se reanuda."
        >
          Reanudar seguimientos tras horas sin respuesta:
          <input
            className={styles.smallInput}
            type="number"
            min={0}
            placeholder="off"
            value={resumeHours}
            onChange={(e) => setResumeHours(e.target.value)}
          />
        </label>
        <button className={styles.primaryBtn} onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {msg && <span className={styles.saveMsg}>{msg}</span>}
      </div>

      {trigger === "webhook" && (
        <div className={styles.webhookBar}>
          <strong>URL del webhook</strong>
          {webhookUrl && workflow.trigger === "webhook" ? (
            <>
              <code className={styles.webhookUrl}>{webhookUrl}</code>
              <button
                className={styles.ghostBtn}
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  setMsg("URL copiada");
                }}
              >
                Copiar
              </button>
              <button className={styles.ghostBtn} onClick={rotateWebhook}>
                Regenerar
              </button>
            </>
          ) : (
            <span className={styles.hint}>Guarda el workflow para generar la URL.</span>
          )}
          <span className={styles.hint}>
            Envía un POST con JSON (name, phone, email y los campos que quieras). El contacto se
            crea o actualiza y entra en este workflow. Añade <code>?agent=ID</code> para elegir el
            agente que atenderá.
          </span>
        </div>
      )}

      <div className={styles.canvasRow}>
        <aside className={styles.palette}>
          <span className={styles.paletteTitle}>Añadir nodo</span>
          {PALETTE.map((k) => (
            <button key={k} className={styles.paletteBtn} onClick={() => addNode(k)}>
              + {META[k].label}
            </button>
          ))}
          <p className={styles.paletteHint}>
            Se añade tras el paso seleccionado. También puedes pulsar <strong>+</strong> en una
            flecha o bajo un paso para insertarlo ahí.
          </p>
          <p className={styles.paletteHint}>
            Variables: {"{name}"}, {"{first_name}"}, {"{email}"}, {"{phone}"}, {"{source}"} y campos
            del formulario.
          </p>
        </aside>

        <div className={styles.canvas} ref={canvasRef}>
          <FlowCtx.Provider value={{ edges, openMenu }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_e, n) => {
                setSelected(n.id);
                setMenu(null);
              }}
              onPaneClick={() => {
                setSelected(null);
                setMenu(null);
              }}
              onMoveStart={() => setMenu(null)}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesConnectable={false}
              edgesFocusable={false}
              fitView
              snapToGrid
              snapGrid={[16, 16]}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} />
            </ReactFlow>
          </FlowCtx.Provider>
          {menu && (
            <div className={styles.insertMenu} style={{ left: menu.x, top: menu.y }}>
              <span className={styles.insertMenuTitle}>
                {menu.between ? "Insertar paso" : "Añadir paso"}
              </span>
              {PALETTE.filter((k) => !(menu.between && isTerminal(k))).map((k) => (
                <button
                  key={k}
                  className={styles.insertMenuItem}
                  onClick={() => insertAfter(menu.source, menu.handle, k)}
                >
                  {META[k].label}
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className={styles.inspector}>
          {!selData ? (
            <p className={styles.hint}>Selecciona un nodo para configurarlo.</p>
          ) : (
            <>
              <span className={styles.inspectorTitle}>{META[selData.kind].label}</span>

              {selData.kind === "message" && (
                <label className={styles.field}>
                  Texto del mensaje
                  <textarea
                    ref={textRef}
                    className={styles.textarea}
                    rows={6}
                    value={selData.text ?? ""}
                    onChange={(e) => patchSelected({ text: e.target.value })}
                    placeholder="hola {name}, vi que dejaste tus datos…"
                  />
                  <div className={styles.varRow}>
                    <select
                      className={styles.input}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) insertVariable(e.target.value);
                        e.target.value = "";
                      }}
                    >
                      <option value="">+ Insertar variable…</option>
                      {VARIABLES.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label} · {`{${v.value}}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className={styles.hint}>
                    También puedes usar campos del formulario, p.ej. {"{ciudad}"}.
                  </span>
                </label>
              )}

              {selData.kind === "wait_reply" && (
                <p className={styles.hint}>
                  Espera a que el lead conteste. Sale por <strong>sí</strong> en cuanto responde y
                  por <strong>no</strong> si pasa el tiempo máximo sin respuesta. Mientras espera,
                  la respuesta del lead no pausa este workflow.
                </p>
              )}

              {(selData.kind === "wait" || selData.kind === "wait_reply") && (
                <div className={styles.formRow}>
                  <label className={styles.field}>
                    {selData.kind === "wait_reply" ? "Tiempo máximo" : "Cantidad"}
                    <input
                      className={styles.smallInput}
                      type="number"
                      min={0}
                      value={selData.amount ?? 0}
                      onChange={(e) => patchSelected({ amount: Number(e.target.value) })}
                    />
                  </label>
                  <label className={styles.field}>
                    Unidad
                    <select
                      className={styles.input}
                      value={selData.unit ?? "hours"}
                      onChange={(e) =>
                        patchSelected({ unit: e.target.value as NodeData["unit"] })
                      }
                    >
                      <option value="minutes">minutos</option>
                      <option value="hours">horas</option>
                      <option value="days">días</option>
                    </select>
                  </label>
                </div>
              )}

              {selData.kind === "if_stage" && (
                <label className={styles.field}>
                  Estado a comprobar
                  <select
                    className={styles.input}
                    value={selData.stage ?? "qualified"}
                    onChange={(e) => patchSelected({ stage: e.target.value })}
                  >
                    <StageOptions pipelines={pipelines} />
                  </select>
                </label>
              )}

              {selData.kind === "if_replied" && (
                <p className={styles.hint}>
                  Rama <strong>sí</strong> si el lead respondió, <strong>no</strong> si no. Paso
                  antiguo: para nuevos flujos usa <strong>Esperar respuesta</strong>, que hace lo
                  mismo con un tiempo máximo.
                </p>
              )}

              {selData.kind === "stop" && (
                <>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={selData.pause_followups ?? false}
                      onChange={(e) => patchSelected({ pause_followups: e.target.checked })}
                    />
                    Pausar seguimientos
                  </label>
                  <label className={styles.field}>
                    Cambiar estado a (opcional)
                    <select
                      className={styles.input}
                      value={selData.set_stage ?? ""}
                      onChange={(e) => patchSelected({ set_stage: e.target.value })}
                    >
                      <option value="">— sin cambio —</option>
                      <StageOptions pipelines={pipelines} />
                    </select>
                  </label>
                </>
              )}

              {selData.kind === "ai_handoff" && (
                <>
                  <label className={styles.field}>
                    Agente que responde
                    <select
                      className={styles.input}
                      value={selData.agent_id ?? ""}
                      onChange={(e) => patchSelected({ agent_id: e.target.value || undefined })}
                    >
                      <option value="">
                        {agentId
                          ? `El del workflow (${agents.find((a) => a.id === agentId)?.name ?? "agente"})`
                          : "El que ya atiende el chat"}
                      </option>
                      {agents
                        .filter((a) => a.is_active)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className={styles.hint}>
                    Activa la IA para que responda a partir de aquí con el agente elegido.
                  </p>
                </>
              )}

              {selData.kind === "webhook" && (
                <>
                  <label className={styles.field}>
                    URL del webhook (https)
                    <input
                      className={styles.input}
                      type="url"
                      value={selData.url ?? ""}
                      onChange={(e) => patchSelected({ url: e.target.value })}
                      placeholder="https://tu-servicio.com/webhook"
                    />
                  </label>
                  <label className={styles.field}>
                    Método HTTP
                    <select
                      className={styles.input}
                      value={selData.method ?? "POST"}
                      onChange={(e) =>
                        patchSelected({ method: e.target.value as NodeData["method"] })
                      }
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    Cuerpo JSON (opcional)
                    <textarea
                      className={styles.textarea}
                      rows={6}
                      value={selData.body ?? ""}
                      onChange={(e) => patchSelected({ body: e.target.value })}
                      placeholder={'{\n  "nombre": "{name}",\n  "telefono": "{phone}"\n}'}
                    />
                  </label>
                  <label className={styles.field}>
                    Headers JSON (opcional)
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={selData.headers ?? ""}
                      onChange={(e) => patchSelected({ headers: e.target.value })}
                      placeholder={'{\n  "x-api-key": "tu-clave"\n}'}
                    />
                  </label>
                  <label className={styles.field}>
                    Token Bearer (opcional)
                    <input
                      className={styles.input}
                      type="password"
                      value={selData.auth_token ?? ""}
                      onChange={(e) => patchSelected({ auth_token: e.target.value })}
                      placeholder="Se envía como Authorization: Bearer …"
                    />
                  </label>
                  <span className={styles.hint}>
                    Si dejas el cuerpo vacío se envían los datos del lead (nombre, teléfono, email,
                    fuente, campaña y campos del formulario). Puedes usar variables como {"{name}"} o{" "}
                    {"{phone}"} en el cuerpo y en los headers.
                  </span>
                </>
              )}

              {selData.kind !== "start" && (
                <button className={styles.dangerBtn} onClick={deleteSelected}>
                  Eliminar nodo
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function WorkflowEditor(props: { workflow: Workflow; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
