"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useStages, type PipelineStage } from "@/lib/stages";
import styles from "../tags/tags.module.css";

const PRESET_COLORS = ["#64748b", "#0ea5e9", "#6366f1", "#f59e0b", "#22c55e", "#16a34a", "#a1a1aa", "#ef4444", "#a855f7", "#14b8a6"];

export default function Stages() {
  const { stages, loading, reload } = useStages();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[2]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6366f1");

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
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      setNewName("");
    });
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
    if (
      !confirm(
        `¿Eliminar la etapa "${s.name}"? Las conversaciones que estén en ella pasarán a "Nuevo".`,
      )
    )
      return;
    void run(() => apiFetch(`/api/stages/${s.id}?fallback=new`, { method: "DELETE" }));
  }

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Nueva etapa</h2>
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
          Las etapas nuevas aparecen en Chats, CRM, Estadísticas, en los workflows (&quot;Al cambiar
          de estado&quot;, &quot;Según estado&quot;) y en las etiquetas que mueven de etapa. La IA
          también las conoce.
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
                  {!s.is_system && (
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
};
