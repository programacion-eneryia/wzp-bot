"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAgents } from "@/lib/agents";
import { useStages, type PipelineStage } from "@/lib/stages";
import styles from "../tags/tags.module.css";
import own from "./stages.module.css";

const PRESET_COLORS = ["#64748b", "#0ea5e9", "#6366f1", "#f59e0b", "#22c55e", "#16a34a", "#a1a1aa", "#ef4444", "#a855f7", "#14b8a6"];

export default function Stages() {
  const { pipelines, loading, reload } = useStages();
  const { agents } = useAgents();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[2]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6366f1");
  const [newPipeline, setNewPipeline] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    if (!pipelines.some((p) => p.id === pipelineId)) setPipelineId(pipelines[0]?.id ?? null);
  }, [pipelines, pipelineId]);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0] ?? null;
  const stages = pipeline?.stages ?? [];
  const pipelineAgents = agents.filter((a) => a.pipeline_id && a.pipeline_id === pipeline?.id);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function create() {
    if (!newName.trim()) {
      setError("Ponle un nombre a la etapa");
      return;
    }
    void run(async () => {
      await apiFetch("/api/stages", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor, pipeline_id: pipeline?.id }),
      });
      setNewName("");
    });
  }

  function createPipeline() {
    if (!newPipeline.trim()) {
      setError("Ponle un nombre al pipeline");
      return;
    }
    void run(async () => {
      const p = await apiFetch<{ id: string }>("/api/stages/pipelines", {
        method: "POST",
        body: JSON.stringify({ name: newPipeline.trim() }),
      });
      setNewPipeline("");
      setPipelineId(p.id);
    });
  }

  function renamePipeline(name: string) {
    if (!pipeline || !name.trim()) return;
    void run(async () => {
      await apiFetch(`/api/stages/pipelines/${pipeline.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: name.trim() }),
      });
      setRenaming(null);
    });
  }

  function removePipeline() {
    if (!pipeline) return;
    if (
      !confirm(
        `¿Eliminar el pipeline "${pipeline.name}" y sus etapas? Sus conversaciones pasarán a la primera etapa del pipeline principal y sus agentes pasarán a usar el principal.`,
      )
    )
      return;
    void run(() => apiFetch(`/api/stages/pipelines/${pipeline.id}`, { method: "DELETE" }));
  }

  function startEdit(s: PipelineStage) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
  }

  function saveEdit() {
    if (!editingId) return;
    void run(async () => {
      await apiFetch(`/api/stages/${editingId}`, {
        method: "PUT",
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      setEditingId(null);
    });
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => apiFetch("/api/stages/reorder", { method: "PUT", body: JSON.stringify({ ids }) }));
  }

  function remove(s: PipelineStage) {
    const fallback = stages.find((x) => x.id !== s.id);
    if (
      !confirm(
        `¿Eliminar la etapa "${s.name}"? Las conversaciones que estén en ella pasarán a "${fallback?.name ?? "la primera etapa"}".`,
      )
    )
      return;
    void run(() =>
      apiFetch(`/api/stages/${s.id}${fallback ? `?fallback=${encodeURIComponent(fallback.key)}` : ""}`, {
        method: "DELETE",
      }),
    );
  }

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      <div className={own.tabs}>
        {pipelines.map((p) => (
          <button
            key={p.id}
            className={`${own.tab} ${p.id === pipeline?.id ? own.tabActive : ""}`}
            onClick={() => {
              setPipelineId(p.id);
              setEditingId(null);
              setRenaming(null);
            }}
          >
            {p.name}
            <span className={own.count}>{p.stages.length}</span>
          </button>
        ))}
        <div className={own.newPipeline}>
          <input
            className={styles.input}
            placeholder="Nuevo pipeline…"
            value={newPipeline}
            onChange={(e) => setNewPipeline(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createPipeline()}
          />
          <button className={styles.ghostBtn} onClick={createPipeline} disabled={busy}>
            + Crear
          </button>
        </div>
      </div>

      {pipeline && (
        <section className={styles.card}>
          <div className={own.pipelineHead}>
            {renaming !== null ? (
              <div className={styles.formRow} style={{ flex: 1 }}>
                <input
                  className={styles.input}
                  style={{ flex: 1 }}
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && renamePipeline(renaming)}
                  autoFocus
                />
                <button className={styles.primaryBtn} onClick={() => renamePipeline(renaming)} disabled={busy}>
                  Guardar
                </button>
                <button className={styles.ghostBtn} onClick={() => setRenaming(null)} disabled={busy}>
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <h2 className={styles.cardTitle} style={{ margin: 0 }}>
                  Pipeline {pipeline.name}
                  {pipeline.is_default && (
                    <span className={`${styles.chip} ${styles.chipStage}`} style={{ marginLeft: 8 }}>
                      principal
                    </span>
                  )}
                </h2>
                <div className={styles.actions}>
                  <button className={styles.ghostBtn} onClick={() => setRenaming(pipeline.name)} disabled={busy}>
                    Renombrar
                  </button>
                  {!pipeline.is_default && (
                    <button className={styles.dangerBtn} onClick={removePipeline} disabled={busy}>
                      Eliminar pipeline
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <p className={styles.hint}>
            {pipelineAgents.length > 0
              ? `Lo usan: ${pipelineAgents.map((a) => a.name).join(", ")}. `
              : "Ningún agente usa este pipeline todavía (se asigna en Agentes → Identidad). "}
            {pipeline.is_default
              ? "Es el embudo comercial: sus etapas de sistema las usan la IA, las estadísticas y las integraciones."
              : "Al pasar una conversación a un agente de este pipeline, entra en su primera etapa."}
          </p>
        </section>
      )}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Nueva etapa{pipeline ? ` en ${pipeline.name}` : ""}</h2>
        <div className={styles.formRow}>
          <label className={styles.field}>
            Color
            <input
              type="color"
              className={styles.color}
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
            />
          </label>
          <label className={styles.field} style={{ flex: 1 }}>
            Nombre
            <input
              className={styles.input}
              style={{ width: "100%" }}
              placeholder="p.ej. Esperando pago, Prueba gratuita…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </label>
          <button className={styles.primaryBtn} onClick={create} disabled={busy}>
            Añadir etapa
          </button>
        </div>
        <p className={styles.hint} style={{ marginTop: 10 }}>
          Las etapas aparecen en Chats, CRM, Estadísticas, en los workflows (&quot;Al cambiar de
          estado&quot;, &quot;Según estado&quot;) y en las etiquetas que mueven de etapa. Cada
          agente solo conoce las etapas de su pipeline.
        </p>
      </section>

      <ul className={styles.list}>
        {loading && stages.length === 0 && <p className={styles.hint}>Cargando…</p>}
        {stages.map((s, i) => (
          <li key={s.id} className={styles.item}>
            {editingId === s.id ? (
              <div className={styles.formRow} style={{ flex: 1 }}>
                <input
                  type="color"
                  className={styles.color}
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                />
                <input
                  className={styles.input}
                  style={{ flex: 1 }}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                  autoFocus
                />
                <button className={styles.primaryBtn} onClick={saveEdit} disabled={busy}>
                  Guardar
                </button>
                <button className={styles.ghostBtn} onClick={() => setEditingId(null)} disabled={busy}>
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>
                    <span className={styles.dot} style={{ background: s.color }} />
                    {s.name}
                    {s.is_system && (
                      <span className={`${styles.chip} ${styles.chipStage}`}>sistema</span>
                    )}
                  </span>
                  <span className={styles.hint}>
                    {SYSTEM_HELP[s.key] ?? "Etapa personalizada de tu negocio."}
                  </span>
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.ghostBtn}
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                    title="Subir"
                  >
                    ↑
                  </button>
                  <button
                    className={styles.ghostBtn}
                    onClick={() => move(i, 1)}
                    disabled={busy || i === stages.length - 1}
                    title="Bajar"
                  >
                    ↓
                  </button>
                  <button className={styles.ghostBtn} onClick={() => startEdit(s)} disabled={busy}>
                    Renombrar
                  </button>
                  {!s.is_system && stages.length > 1 && (
                    <button className={styles.dangerBtn} onClick={() => remove(s)} disabled={busy}>
                      Eliminar
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SYSTEM_HELP: Record<string, string> = {
  new: "Acaba de entrar; el agente aún no lo ha trabajado.",
  qualifying: "El agente está conversando y cualificando.",
  qualified: "Cumple los criterios; listo para agendar.",
  calendar_sent: "El agente ya le envió el enlace de agenda; falta que reserve.",
  call_scheduled: "Cita confirmada (webhook del calendario / GHL). El agente deja de escribir.",
  won: "Cliente cerrado.",
  not_qualified: "No encaja con los criterios.",
  lost: "Se perdió el interés o dijo que no.",
  support_new: "Acaba de escribir; aún no se ha atendido.",
  support_open: "El agente está resolviendo la consulta.",
  support_waiting: "Le hemos respondido y esperamos su respuesta.",
  support_resolved: "Consulta resuelta.",
};
