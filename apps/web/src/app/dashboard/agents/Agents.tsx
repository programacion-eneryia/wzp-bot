"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, apiUpload } from "@/lib/api";
import { AGENT_KIND_LABEL, invalidateAgents, useAgents, type Agent, type AgentKind } from "@/lib/agents";
import styles from "./agents.module.css";

type Channel = {
  id: string;
  provider: string;
  status: string;
  display_name: string | null;
  agent_id?: string | null;
};

type Calendar = { id: string; provider: string; name: string | null; status: string };

const PROVIDER_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  linkedin: "LinkedIn",
  telegram: "Telegram",
};

// Modelos permitidos (deben coincidir con ALLOWED_MODELS del backend).
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "El de la Base de Conocimiento (por defecto)" },
  { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (rápido/barato)" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini (rápido/barato)" },
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
];

const KIND_CHIP: Record<AgentKind, string> = {
  setter: styles.chipKind,
  support: styles.chipSupport,
  custom: styles.chipCustom,
};

export default function Agents({ isAdmin = true }: { isAdmin?: boolean }) {
  const { agents, loading, reload } = useAgents();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Channel[]>("/api/channels").then(setChannels).catch(() => {});
    apiFetch<Calendar[]>("/api/calendar").then(setCalendars).catch(() => {});
  }, []);

  async function refresh() {
    invalidateAgents();
    await reload();
    try {
      setChannels(await apiFetch<Channel[]>("/api/channels"));
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
              {!a.uses_stages && <span className={`${styles.chip} ${styles.chipOff}`}>sin embudo</span>}
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

type EditorTab = "identity" | "conversation" | "calendar" | "learn" | "channels";

const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: "identity", label: "Identidad" },
  { id: "conversation", label: "Cómo conversa" },
  { id: "calendar", label: "Agenda" },
  { id: "learn", label: "Aprendizaje" },
  { id: "channels", label: "Canales" },
];

/** Campos del agente que se envían en el PUT. */
const EDITABLE: (keyof Agent)[] = [
  "name",
  "kind",
  "is_active",
  "uses_stages",
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
  isAdmin,
  onBack,
}: {
  agent: Agent;
  channels: Channel[];
  calendars: Calendar[];
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
                  onChange={(e) => {
                    const kind = e.target.value as AgentKind;
                    set("kind", kind);
                    if (kind === "support") set("uses_stages", false);
                    if (kind === "setter") set("uses_stages", true);
                  }}
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
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={agent.uses_stages}
                onChange={(e) => set("uses_stages", e.target.checked)}
              />
              <span>
                <strong>Usa el embudo (Pipelines y Stages)</strong> — las conversaciones de este
                agente avanzan por etapas y cuentan en Estadísticas. Desmárcalo para soporte.
              </span>
            </label>
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
