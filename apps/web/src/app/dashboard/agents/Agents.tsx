"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, apiUpload } from "@/lib/api";
import {
  AGENT_KIND_LABEL,
  invalidateAgents,
  useAgents,
  type Agent,
  type AgentBehavior,
  type AgentKind,
} from "@/lib/agents";
import { MODEL_CHOICES, timezoneOptions } from "@/lib/ai-options";
import { useStages, type Pipeline } from "@/lib/stages";
import SilencedContacts from "../setter/SilencedContacts";
import GeneralSettings from "./GeneralSettings";
import PauseOnManualToggle from "./PauseOnManualToggle";
import styles from "./agents.module.css";

type Channel = {
  id: string;
  provider: string;
  status: string;
  display_name: string | null;
  agent_id?: string | null;
};

const liveChannels = (cs: Channel[]) => cs.filter((c) => c.status !== "disconnected");

type Calendar = { id: string; provider: string; name: string | null; status: string };

const PROVIDER_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  linkedin: "LinkedIn",
  telegram: "Telegram",
};

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "El de los ajustes generales (por defecto)" },
  ...MODEL_CHOICES,
];

const KIND_CHIP: Record<AgentKind, string> = {
  setter: styles.chipKind,
  support: styles.chipSupport,
  custom: styles.chipCustom,
};

export default function Agents({ isAdmin = true }: { isAdmin?: boolean }) {
  const { agents, loading, reload } = useAgents();
  const { pipelines } = useStages();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Channel[]>("/api/channels").then((cs) => setChannels(liveChannels(cs))).catch(() => {});
    apiFetch<Calendar[]>("/api/calendar").then(setCalendars).catch(() => {});
  }, []);

  async function refresh() {
    invalidateAgents();
    await reload();
    try {
      setChannels(liveChannels(await apiFetch<Channel[]>("/api/channels")));
    } catch {
      /* ignore */
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function create(kind: AgentKind) {
    void run(async () => {
      const a = await apiFetch<Agent>("/api/agents", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      setEditing(a);
    });
  }

  function duplicate(a: Agent) {
    void run(async () => {
      const copy = await apiFetch<Agent>(`/api/agents/${a.id}/duplicate`, { method: "POST" });
      setEditing(copy);
    });
  }

  function toggleActive(a: Agent) {
    void run(() =>
      apiFetch(`/api/agents/${a.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !a.is_active }),
      }),
    );
  }

  async function setDefault(kind: "lead" | "conversation", agentId: string | null) {
    const col = kind === "lead" ? "is_default_lead" : "is_default_conversation";
    const current = agents.find((a) => a[col]);
    await run(async () => {
      if (agentId) {
        await apiFetch(`/api/agents/${agentId}`, {
          method: "PUT",
          body: JSON.stringify({ [col]: true }),
        });
      } else if (current) {
        await apiFetch(`/api/agents/${current.id}`, {
          method: "PUT",
          body: JSON.stringify({ [col]: false }),
        });
      }
    });
  }

  function remove(a: Agent) {
    if (
      !confirm(
        `¿Eliminar el agente "${a.name}"? Sus canales pasarán al agente por defecto y las conversaciones que lo tenían asignado volverán al agente del canal.`,
      )
    )
      return;
    void run(() => apiFetch(`/api/agents/${a.id}`, { method: "DELETE" }));
  }

  if (editing) {
    return (
      <AgentEditor
        agent={editing}
        channels={channels}
        calendars={calendars}
        pipelines={pipelines}
        isAdmin={isAdmin}
        onBack={() => {
          setEditing(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      <GeneralSettings agents={agents} isAdmin={isAdmin} onSetDefault={setDefault} />

      <div className={styles.toolbar}>
        <button className={styles.primaryBtn} onClick={() => create("setter")} disabled={busy}>
          + Nuevo Setter
        </button>
        <button className={styles.ghostBtn} onClick={() => create("support")} disabled={busy}>
          + Nuevo Soporte
        </button>
        <button className={styles.ghostBtn} onClick={() => create("custom")} disabled={busy}>
          + Agente personalizado
        </button>
      </div>

      {loading && agents.length === 0 && <p className={styles.muted}>Cargando agentes…</p>}

      <div className={styles.grid}>
        {agents.map((a) => (
          <div key={a.id} className={`${styles.agentCard} ${a.is_active ? "" : styles.agentCardOff}`}>
            <div className={styles.agentHead}>
              <div>
                <div className={styles.agentName}>{a.name}</div>
                <div className={styles.agentPersona}>
                  {a.persona_name} · {a.identity_role}
                </div>
              </div>
              <span className={`${styles.chip} ${a.is_active ? styles.chipOn : styles.chipOff}`}>
                {a.is_active ? "Activo" : "Inactivo"}
              </span>
            </div>
            <div className={styles.chips}>
              <span className={`${styles.chip} ${KIND_CHIP[a.kind]}`}>{AGENT_KIND_LABEL[a.kind]}</span>
              {a.is_default_lead && (
                <span className={`${styles.chip} ${styles.chipOn}`}>por defecto · leads</span>
              )}
              {a.is_default_conversation && (
                <span className={`${styles.chip} ${styles.chipOn}`}>por defecto · conversaciones</span>
              )}
              <span className={`${styles.chip} ${styles.chipOff}`}>
                {a.pipeline_id
                  ? `pipeline ${pipelines.find((p) => p.id === a.pipeline_id)?.name ?? ""}`
                  : "sin pipeline"}
              </span>
              {a.behavior && <span className={`${styles.chip} ${styles.chipOff}`}>ajustes propios</span>}
              {a.calendar_mode !== "off" && (
                <span className={`${styles.chip} ${styles.chipOff}`}>
                  {a.calendar_mode === "link" ? "agenda por enlace" : "agenda por huecos"}
                </span>
              )}
            </div>
            <p className={styles.agentObjective}>{a.objective}</p>
            <div className={styles.chips}>
              {(a.channels ?? []).length === 0 ? (
                <span className={styles.muted}>Sin canales asignados</span>
              ) : (
                (a.channels ?? []).map((c) => (
                  <span key={c.id} className={`${styles.chip} ${styles.chipChannel}`}>
                    {PROVIDER_LABEL[c.provider] ?? c.provider}
                    {c.display_name ? ` · ${c.display_name}` : ""}
                  </span>
                ))
              )}
            </div>
            <div className={styles.actions}>
              <button className={styles.ghostBtn} onClick={() => setEditing(a)} disabled={busy}>
                Editar
              </button>
              <button className={styles.ghostBtn} onClick={() => toggleActive(a)} disabled={busy}>
                {a.is_active ? "Desactivar" : "Activar"}
              </button>
              <button className={styles.ghostBtn} onClick={() => duplicate(a)} disabled={busy}>
                Duplicar
              </button>
              {agents.length > 1 && (
                <button className={styles.dangerBtn} onClick={() => remove(a)} disabled={busy}>
                  Eliminar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                             */
/* ------------------------------------------------------------------ */

type EditorTab = "identity" | "conversation" | "calendar" | "settings" | "learn" | "channels";

const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: "identity", label: "Identidad" },
  { id: "conversation", label: "Cómo conversa" },
  { id: "calendar", label: "Agenda" },
  { id: "settings", label: "Ajustes de IA" },
  { id: "learn", label: "Aprendizaje" },
  { id: "channels", label: "Canales" },
];

/** Campos que la IA rellena desde un brief/documento. */
type BriefFields = Partial<
  Pick<
    Agent,
    | "persona_name"
    | "identity_role"
    | "objective"
    | "tone"
    | "rules"
    | "instructions"
    | "qualification_criteria"
    | "funnel_phases"
    | "conversation_types"
    | "special_cases"
    | "followups"
    | "best_practices"
  >
>;

/** Editor de la secuencia de seguimientos (cada espera cuenta desde el mensaje anterior). */
function FollowupSteps({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const unitOf = (min: number): [number, 1 | 60 | 1440] =>
    min % 1440 === 0 ? [min / 1440, 1440] : min % 60 === 0 ? [min / 60, 60] : [min, 1];
  const update = (i: number, minutes: number) => {
    const next = [...value];
    next[i] = Math.max(1, Math.round(minutes));
    onChange(next);
  };
  return (
    <div>
      {value.map((min, i) => {
        const [amount, unit] = unitOf(min);
        return (
          <div className={styles.row} key={i}>
            <label className={styles.field}>
              <span className={styles.label}>
                {i === 0
                  ? "1er seguimiento, tras el último mensaje del agente"
                  : `${i + 1}º seguimiento, tras el anterior`}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  className={styles.input}
                  style={{ width: 90 }}
                  value={amount}
                  onChange={(e) => update(i, Number(e.target.value) * unit)}
                />
                <select
                  className={styles.select}
                  value={unit}
                  onChange={(e) => update(i, amount * Number(e.target.value))}
                >
                  <option value={1}>minutos</option>
                  <option value={60}>horas</option>
                  <option value={1440}>días</option>
                </select>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  disabled={value.length <= 1}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  title="Quitar este seguimiento"
                >
                  ✕
                </button>
              </div>
            </label>
          </div>
        );
      })}
      {value.length < 6 && (
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => onChange([...value, Math.min(value[value.length - 1] * 2, 10080)])}
        >
          + Añadir otro seguimiento
        </button>
      )}
      <p className={styles.muted}>
        Solo se envían dentro del horario de respuesta del agente. El último seguimiento cierra
        dejando la puerta abierta; después, el agente no vuelve a insistir hasta que el lead
        escriba.
      </p>
    </div>
  );
}

/** Valores de partida cuando un agente activa ajustes propios. */
const BEHAVIOR_DEFAULTS: Required<AgentBehavior> = {
  multi_bubble: true,
  first_reply_min_s: 5,
  first_reply_max_s: 15,
  active_hours_enabled: false,
  active_hours_start: 9,
  active_hours_end: 21,
  timezone: "Europe/Madrid",
};

/** Campos del agente que se envían en el PUT. */
const EDITABLE: (keyof Agent)[] = [
  "name",
  "kind",
  "is_active",
  "pipeline_id",
  "is_default_lead",
  "is_default_conversation",
  "behavior",
  "followup_enabled",
  "followup_delays_min",
  "persona_name",
  "identity_role",
  "objective",
  "tone",
  "rules",
  "instructions",
  "qualification_criteria",
  "funnel_phases",
  "conversation_types",
  "special_cases",
  "followups",
  "best_practices",
  "winning_examples",
  "calendar_mode",
  "calendar_link",
  "call_duration_min",
  "default_calendar_id",
  "model",
];

function AgentEditor({
  agent: initial,
  channels,
  calendars,
  pipelines,
  isAdmin,
  onBack,
}: {
  agent: Agent;
  channels: Channel[];
  calendars: Calendar[];
  pipelines: Pipeline[];
  isAdmin: boolean;
  onBack: () => void;
}) {
  const [agent, setAgent] = useState<Agent>(initial);
  const [tab, setTab] = useState<EditorTab>("identity");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    channels.filter((c) => c.agent_id === initial.id).map((c) => c.id),
  );
  const [channelsDirty, setChannelsDirty] = useState(false);
  const examplesRef = useRef<HTMLInputElement>(null);
  const [examplesInfo, setExamplesInfo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [brief, setBrief] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefInfo, setBriefInfo] = useState<string | null>(null);
  const briefRef = useRef<HTMLInputElement>(null);

  /** La IA lee el texto y/o los documentos y rellena los campos (sin guardar). */
  async function fillFromBrief(files?: FileList) {
    if (!brief.trim() && !files?.length) {
      setError("Pega un texto o sube un documento para que la IA rellene el agente");
      return;
    }
    setBriefBusy(true);
    setError(null);
    setBriefInfo(null);
    try {
      const form = new FormData();
      if (brief.trim()) form.append("brief", brief.trim());
      Array.from(files ?? []).forEach((f) => form.append("files", f));
      form.append("agent_id", agent.id);
      const r = await apiUpload<{ fields: BriefFields; extractedChars: number; files: number }>(
        "/api/setter/agent-brief",
        form,
      );
      const filled = Object.keys(r.fields).length;
      setAgent((prev) => ({ ...prev, ...r.fields }));
      setSaved(false);
      setBriefInfo(
        `La IA ha rellenado ${filled} campo(s)${r.files ? ` a partir de ${r.files} documento(s)` : ""}. Revísalos en cada pestaña y pulsa "Guardar cambios".`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setBriefBusy(false);
      if (briefRef.current) briefRef.current.value = "";
    }
  }

  const behavior = agent.behavior;
  function setBehavior<K extends keyof AgentBehavior>(key: K, value: AgentBehavior[K]) {
    setAgent((prev) => ({ ...prev, behavior: { ...(prev.behavior ?? {}), [key]: value } }));
    setSaved(false);
  }
  const bv = { ...BEHAVIOR_DEFAULTS, ...(behavior ?? {}) };

  function set<K extends keyof Agent>(key: K, value: Agent[K]) {
    setAgent((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const k of EDITABLE) payload[k] = agent[k];
      if (!payload.model) payload.model = null;
      const updated = await apiFetch<Agent>(`/api/agents/${agent.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (channelsDirty) {
        await apiFetch(`/api/agents/${agent.id}/channels`, {
          method: "PUT",
          body: JSON.stringify({ channel_ids: selectedChannels }),
        });
        setChannelsDirty(false);
      }
      setAgent({ ...updated, channels: agent.channels });
      invalidateAgents();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function uploadExamples(files: FileList) {
    setUploading(true);
    setError(null);
    setExamplesInfo(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      form.append("append", "true");
      form.append("agent_id", agent.id);
      const r = await apiUpload<{ agent: Agent; extractedChars: number; files: number }>(
        "/api/setter/examples-from-file",
        form,
      );
      setAgent((prev) => ({ ...prev, winning_examples: r.agent.winning_examples }));
      setExamplesInfo(
        `${r.files} conversación(es) añadidas (${r.extractedChars.toLocaleString()} caracteres). El agente aprenderá de ellas.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al leer las conversaciones");
    } finally {
      setUploading(false);
      if (examplesRef.current) examplesRef.current.value = "";
    }
  }

  const area = (key: keyof Agent, label: string, rows = 3, hint?: string, placeholder?: string) => (
    <label className={styles.field}>
      <span className={styles.label}>
        {label}
        {hint && <span className={styles.hint}> — {hint}</span>}
      </span>
      <textarea
        className={styles.textarea}
        rows={rows}
        value={(agent[key] as string | null) ?? ""}
        onChange={(e) => set(key, e.target.value as never)}
        placeholder={placeholder}
      />
    </label>
  );

  const isSupport = agent.kind === "support";

  return (
    <div className={styles.wrap}>
      <div className={styles.editorHead}>
        <button className={styles.ghostBtn} onClick={onBack}>
          ← Volver
        </button>
        <input
          className={styles.nameInput}
          value={agent.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Nombre del agente"
        />
        <span className={`${styles.chip} ${KIND_CHIP[agent.kind]}`}>{AGENT_KIND_LABEL[agent.kind]}</span>
        <label className={styles.checkRow} style={{ marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={agent.is_active}
            onChange={(e) => set("is_active", e.target.checked)}
          />
          Activo
        </label>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        {EDITOR_TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "identity" && (
        <>
          {isAdmin && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>✨ Rellenar con IA desde un documento</h2>
              <p className={styles.muted}>
                Pega el brief de este agente o sube su guion, manual o SOP (PDF, Word o TXT). La IA
                rellena identidad, objetivo, reglas, fases y casos. Nada se guarda hasta que pulses
                &quot;Guardar cambios&quot;.
              </p>
              <textarea
                className={styles.textarea}
                rows={4}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Ej: Este agente atiende a clientes que ya compraron el curso. Resuelve dudas de acceso, facturación…"
              />
              <div className={styles.toolbar}>
                <button
                  className={styles.primaryBtn}
                  onClick={() => void fillFromBrief()}
                  disabled={briefBusy}
                >
                  {briefBusy ? "Analizando…" : "Rellenar desde el texto"}
                </button>
                <input
                  ref={briefRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className={styles.fileInput}
                  onChange={(e) => {
                    const fs = e.target.files;
                    if (fs && fs.length > 0) void fillFromBrief(fs);
                  }}
                  disabled={briefBusy}
                />
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => briefRef.current?.click()}
                  disabled={briefBusy}
                >
                  Subir documento
                </button>
              </div>
              {briefInfo && <p className={styles.savedMsg}>{briefInfo}</p>}
            </section>
          )}

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Quién es</h2>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Nombre con el que se presenta</span>
                <input
                  className={styles.input}
                  value={agent.persona_name}
                  onChange={(e) => set("persona_name", e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Rol</span>
                <input
                  className={styles.input}
                  value={agent.identity_role}
                  onChange={(e) => set("identity_role", e.target.value)}
                  placeholder="p.ej. Setter del equipo comercial"
                />
              </label>
            </div>
            {area("objective", "Objetivo", 3, "qué debe conseguir en cada conversación")}
            {area("tone", "Tono y estilo", 2)}
            {area("rules", "Reglas y límites", 3, "qué NO hacer")}
            {area(
              "instructions",
              "Instrucciones adicionales",
              4,
              "cualquier indicación específica para este agente",
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Tipo de agente</h2>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Tipo</span>
                <select
                  className={styles.select}
                  value={agent.kind}
                  onChange={(e) => set("kind", e.target.value as AgentKind)}
                >
                  <option value="setter">Setter — cualifica y agenda</option>
                  <option value="support">Soporte — atiende clientes</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
              {isAdmin && (
                <label className={styles.field}>
                  <span className={styles.label}>Modelo LLM</span>
                  <select
                    className={styles.select}
                    value={agent.model ?? ""}
                    onChange={(e) => set("model", e.target.value || null)}
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label className={styles.field}>
              <span className={styles.label}>
                Pipeline{" "}
                <span className={styles.hint}>
                  — etapas por las que avanzan sus conversaciones (se editan en Pipelines y Stages)
                </span>
              </span>
              <select
                className={styles.select}
                value={agent.pipeline_id ?? ""}
                onChange={(e) => set("pipeline_id", e.target.value || null)}
              >
                <option value="">Sin pipeline</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_default ? " (principal)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Cuándo se activa solo</h2>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={agent.is_default_lead}
                onChange={(e) => set("is_default_lead", e.target.checked)}
              />
              <span>
                <strong>Predeterminado para leads</strong> — atiende a los leads que entran por
                formulario, GoHighLevel o webhook (si no indican otro agente).
              </span>
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={agent.is_default_conversation}
                onChange={(e) => set("is_default_conversation", e.target.checked)}
              />
              <span>
                <strong>Predeterminado para conversaciones nuevas</strong> — responde a quien
                escribe por primera vez por un canal sin agente asignado.
              </span>
            </label>
            <p className={styles.muted}>
              Solo puede haber un agente predeterminado de cada tipo; al marcar este, se desmarca el
              anterior. Si no hay ninguno, los chats nuevos entran con la IA pausada.
            </p>
          </section>
        </>
      )}

      {tab === "conversation" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Cómo conversa</h2>
          {!isSupport && area("qualification_criteria", "Criterios de cualificación", 4)}
          {!isSupport &&
            area("funnel_phases", "Fases de la conversación", 6, "apertura → cualificar → … → cierre")}
          {area("conversation_types", "Tipos de conversación", 4, "situaciones típicas y cómo actuar")}
          {area("special_cases", "Casos especiales", 4)}
          {area("followups", "Seguimiento", 3, "qué hacer si no responde")}
          {area("best_practices", "Buenas prácticas", 4)}
        </section>
      )}

      {tab === "conversation" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Seguimiento automático</h2>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={Boolean(agent.followup_enabled)}
              onChange={(e) => set("followup_enabled", e.target.checked)}
            />
            <span>
              <strong>Volver a escribir si el lead no contesta</strong> — cuando el agente manda
              un mensaje y la persona no responde, le escribe un seguimiento corto y natural
              (retoma lo pendiente: el vídeo que le pasó, la pregunta, la llamada). Se detiene
              en cuanto el lead responde, si agenda, si se descarta o si una persona toma el
              chat.
            </span>
          </label>
          {agent.followup_enabled && (
            <FollowupSteps
              value={agent.followup_delays_min ?? [60, 1440, 4320]}
              onChange={(v) => set("followup_delays_min", v)}
            />
          )}
        </section>
      )}

      {tab === "calendar" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Agendar llamadas</h2>
          <label className={styles.field}>
            <span className={styles.label}>Modo</span>
            <select
              className={styles.select}
              value={agent.calendar_mode}
              onChange={(e) => set("calendar_mode", e.target.value as Agent["calendar_mode"])}
            >
              <option value="off">No agenda llamadas</option>
              <option value="link">Envía un enlace de agenda (Calendly, GHL…)</option>
              <option value="slots">Propone huecos del calendario conectado</option>
            </select>
          </label>
          {agent.calendar_mode === "link" && (
            <label className={styles.field}>
              <span className={styles.label}>
                Enlace de agenda{" "}
                <span className={styles.hint}>
                  — cuando el agente lo envíe, el lead pasará a &quot;Calendario enviado&quot;
                </span>
              </span>
              <input
                className={styles.input}
                value={agent.calendar_link ?? ""}
                onChange={(e) => set("calendar_link", e.target.value || null)}
                placeholder="https://calendly.com/…"
              />
            </label>
          )}
          {agent.calendar_mode === "slots" && (
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Calendario</span>
                <select
                  className={styles.select}
                  value={agent.default_calendar_id ?? ""}
                  onChange={(e) => set("default_calendar_id", e.target.value || null)}
                >
                  <option value="">El calendario por defecto</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.provider} ({c.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Duración de la llamada (min)</span>
                <input
                  type="number"
                  min={5}
                  className={styles.input}
                  value={agent.call_duration_min}
                  onChange={(e) => set("call_duration_min", Number(e.target.value))}
                />
              </label>
            </div>
          )}
          <p className={styles.muted}>
            &quot;Llamada agendada&quot; solo se marca cuando la cita se confirma (webhook del
            calendario o GoHighLevel), nunca porque el lead diga que ya reservó.
          </p>
        </section>
      )}

      {tab === "settings" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Comportamiento de este agente</h2>
            <PauseOnManualToggle isAdmin={isAdmin} />
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={Boolean(behavior)}
                onChange={(e) => set("behavior", e.target.checked ? { ...BEHAVIOR_DEFAULTS } : null)}
              />
              <span>
                <strong>Usar ajustes propios</strong> — si no, usa los ajustes generales de la
                cuenta (horario, tiempos de respuesta…).
              </span>
            </label>
            {behavior && (
              <>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={bv.multi_bubble}
                    onChange={(e) => setBehavior("multi_bubble", e.target.checked)}
                  />
                  <span>Dividir respuestas en varias burbujas</span>
                </label>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span className={styles.label}>Tiempo mín. en contestar (seg)</span>
                    <input
                      type="number"
                      className={styles.input}
                      value={bv.first_reply_min_s}
                      onChange={(e) => setBehavior("first_reply_min_s", Number(e.target.value))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Tiempo máx. en contestar (seg)</span>
                    <input
                      type="number"
                      className={styles.input}
                      value={bv.first_reply_max_s}
                      onChange={(e) => setBehavior("first_reply_max_s", Number(e.target.value))}
                    />
                  </label>
                </div>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={bv.active_hours_enabled}
                    onChange={(e) => setBehavior("active_hours_enabled", e.target.checked)}
                  />
                  <span>Responder solo dentro de un horario</span>
                </label>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span className={styles.label}>Inicio (hora, 0-23)</span>
                    <input
                      type="number"
                      className={styles.input}
                      value={bv.active_hours_start}
                      onChange={(e) => setBehavior("active_hours_start", Number(e.target.value))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Fin (hora, 0-23)</span>
                    <input
                      type="number"
                      className={styles.input}
                      value={bv.active_hours_end}
                      onChange={(e) => setBehavior("active_hours_end", Number(e.target.value))}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Zona horaria</span>
                    <select
                      className={styles.select}
                      value={bv.timezone}
                      onChange={(e) => setBehavior("timezone", e.target.value)}
                    >
                      {!timezoneOptions().includes(bv.timezone) && (
                        <option value={bv.timezone}>{bv.timezone}</option>
                      )}
                      {timezoneOptions().map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
          </section>
          <SilencedContacts agentId={agent.id} agentName={agent.name} />
        </>
      )}

      {tab === "learn" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Aprender de conversaciones que funcionaron</h2>
          <p className={styles.muted}>
            Sube conversaciones antiguas que salieron bien. El agente aprenderá su estilo, el
            orden de las preguntas y la forma de cerrar. Puedes subir varias; se acumulan. También
            puedes marcar chats como ejemplo desde la bandeja de Chats.
          </p>
          <div>
            <input
              ref={examplesRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className={styles.fileInput}
              onChange={(e) => {
                const fs = e.target.files;
                if (fs && fs.length > 0) void uploadExamples(fs);
              }}
              disabled={uploading}
            />
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => examplesRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Leyendo…" : "Subir conversaciones (PDF, Word o TXT)"}
            </button>
          </div>
          {examplesInfo && <p className={styles.savedMsg}>{examplesInfo}</p>}
          {area(
            "winning_examples",
            "Conversaciones de ejemplo",
            12,
            "puedes pegarlas o editarlas a mano",
            "LEAD: hola, vi el anuncio...\nSETTER: hola! cuéntame, ¿qué te llamó la atención?...",
          )}
        </section>
      )}

      {tab === "channels" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Canales que atiende por defecto</h2>
          <p className={styles.muted}>
            Los mensajes nuevos de estos canales los responde este agente (salvo que la
            conversación tenga otro agente asignado a mano o por workflow). Un canal solo puede
            tener un agente por defecto.
          </p>
          {channels.length === 0 ? (
            <p className={styles.muted}>No hay canales conectados todavía.</p>
          ) : (
            <div className={styles.channelList}>
              {channels.map((c) => {
                const checked = selectedChannels.includes(c.id);
                const otherOwner = !checked && c.agent_id && c.agent_id !== agent.id;
                return (
                  <label key={c.id} className={styles.channelRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedChannels((prev) =>
                          e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                        );
                        setChannelsDirty(true);
                        setSaved(false);
                      }}
                    />
                    <span>
                      {PROVIDER_LABEL[c.provider] ?? c.provider}
                      {c.display_name ? ` · ${c.display_name}` : ""}
                    </span>
                    <span className={styles.channelMeta}>
                      {c.status !== "connected" ? `${c.status} · ` : ""}
                      {otherOwner ? "asignado a otro agente" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className={styles.footer}>
        <button className={styles.primaryBtn} onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved && <span className={styles.savedMsg}>Guardado ✓</span>}
      </div>
    </div>
  );
}
