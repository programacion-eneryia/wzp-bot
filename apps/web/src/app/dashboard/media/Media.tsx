"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAgents } from "@/lib/agents";
import {
  MEDIA_KIND_LABEL,
  MEDIA_MAX_BYTES,
  formatBytes,
  kindFromMime,
  uploadMedia,
  useMedia,
  type MediaAsset,
} from "@/lib/media";
import styles from "./media.module.css";

const ACCEPT =
  "audio/*,video/mp4,video/quicktime,image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

type Draft = {
  name: string;
  description: string;
  as_voice_note: boolean;
  ai_enabled: boolean;
  agent_id: string;
};

const EMPTY: Draft = { name: "", description: "", as_voice_note: true, ai_enabled: true, agent_id: "" };

const KIND_ICON: Record<MediaAsset["kind"], string> = {
  audio: "♪",
  video: "▶",
  image: "▣",
  document: "▤",
};

export default function Media({ isAdmin }: { isAdmin: boolean }) {
  const { assets, loading, error: loadError, reload } = useMedia();
  const { agents } = useAgents();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ asset: MediaAsset; url: string } | null>(null);

  const fileKind = file ? kindFromMime(file.type || "") : null;
  const editing = editingId ? assets.find((a) => a.id === editingId) ?? null : null;

  function pickFile(f: File | null) {
    setFile(f);
    if (f && !draft.name.trim()) {
      setDraft((d) => ({ ...d, name: f.name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_-]+/g, " ") }));
    }
  }

  function resetForm() {
    setEditingId(null);
    setFile(null);
    setDraft(EMPTY);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function startEdit(a: MediaAsset) {
    setEditingId(a.id);
    setFile(null);
    setDraft({
      name: a.name,
      description: a.description ?? "",
      as_voice_note: a.as_voice_note,
      ai_enabled: a.ai_enabled,
      agent_id: a.agent_id ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("Ponle un nombre al archivo (la IA lo usa para identificarlo)");
      return;
    }
    if (!editingId && !file) {
      setError("Elige el archivo que quieres subir");
      return;
    }
    if (file && file.size > MEDIA_MAX_BYTES) {
      setError("El archivo supera los 16 MB que admite WhatsApp");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await apiFetch(`/api/media/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            as_voice_note: draft.as_voice_note,
            ai_enabled: draft.ai_enabled,
            agent_id: draft.agent_id || null,
          }),
        });
      } else if (file) {
        setProgress(0);
        await uploadMedia(
          file,
          {
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            as_voice_note: fileKind === "audio" && draft.as_voice_note,
            ai_enabled: draft.ai_enabled,
            agent_id: draft.agent_id || null,
          },
          setProgress,
        );
      }
      resetForm();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el archivo");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: MediaAsset) {
    if (!confirm(`¿Eliminar "${a.name}"? Los workflows que lo usen dejarán de enviarlo.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/media/${a.id}`, { method: "DELETE" });
      if (editingId === a.id) resetForm();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAi(a: MediaAsset) {
    setBusy(true);
    try {
      await apiFetch(`/api/media/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ai_enabled: !a.ai_enabled }),
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(a: MediaAsset) {
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/media/${a.id}/url`);
      setPreview({ asset: a, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el archivo");
    }
  }

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "agente" : null);

  return (
    <div className={styles.wrap}>
      {(error || loadError) && <div className={styles.error}>{error ?? loadError}</div>}

      {isAdmin && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{editing ? `Editar "${editing.name}"` : "Subir un archivo"}</h2>
          <div className={styles.form}>
            {!editing && (
              <div
                className={`${styles.drop} ${file ? styles.dropFilled : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  hidden
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <>
                    <span className={styles.dropIcon}>{KIND_ICON[fileKind ?? "document"]}</span>
                    <strong>{file.name}</strong>
                    <span className={styles.hint}>
                      {MEDIA_KIND_LABEL[fileKind ?? "document"]} · {formatBytes(file.size)} · pulsa para cambiar
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.dropIcon}>⇪</span>
                    <strong>Arrastra aquí un archivo o pulsa para elegirlo</strong>
                    <span className={styles.hint}>
                      Audio (mp3, m4a, ogg), vídeo (mp4), imagen (jpg, png) o documento (pdf, docx…). Máx. 16 MB.
                    </span>
                  </>
                )}
              </div>
            )}

            <div className={styles.formRow}>
              <label className={styles.field} style={{ flex: 1 }}>
                Nombre (así lo identifica la IA)
                <input
                  className={styles.input}
                  style={{ width: "100%" }}
                  placeholder="p.ej. Vídeo explicación de la oferta"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                Solo para el agente
                <select
                  className={styles.select}
                  value={draft.agent_id}
                  onChange={(e) => setDraft({ ...draft, agent_id: e.target.value })}
                >
                  <option value="">Cualquier agente</option>
                  {agents
                    .filter((a) => a.is_active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <label className={styles.field}>
              ¿Cuándo debe enviarlo la IA? (condición en lenguaje natural)
              <textarea
                className={styles.textarea}
                rows={3}
                placeholder="p.ej. Cuando la persona pregunte por el precio o cómo funciona el programa, antes de proponer la llamada."
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>

            <div className={styles.formRow}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.ai_enabled}
                  onChange={(e) => setDraft({ ...draft, ai_enabled: e.target.checked })}
                />
                La IA puede enviarlo por su cuenta
              </label>
              {(fileKind === "audio" || editing?.kind === "audio") && (
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={draft.as_voice_note}
                    onChange={(e) => setDraft({ ...draft, as_voice_note: e.target.checked })}
                  />
                  Enviar como nota de voz (WhatsApp)
                </label>
              )}
              <div style={{ flex: 1 }} />
              {(editing || file) && (
                <button className={styles.ghostBtn} onClick={resetForm} disabled={busy}>
                  Cancelar
                </button>
              )}
              <button className={styles.primaryBtn} onClick={save} disabled={busy}>
                {busy && progress !== null && progress < 100
                  ? `Subiendo… ${progress}%`
                  : editing
                    ? "Guardar cambios"
                    : "Subir archivo"}
              </button>
            </div>
            {progress !== null && (
              <div className={styles.progress}>
                <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        </section>
      )}

      <ul className={styles.list}>
        {!loading && assets.length === 0 && (
          <p className={styles.hint}>
            {isAdmin
              ? "Aún no hay archivos. Sube el primero arriba (un audio de presentación, el vídeo de la oferta, un PDF con precios…)."
              : "Aún no hay archivos. Un administrador puede subirlos desde esta página."}
          </p>
        )}
        {assets.map((a) => (
          <li key={a.id} className={styles.item}>
            <button className={styles.thumb} onClick={() => openPreview(a)} title="Ver / escuchar">
              {KIND_ICON[a.kind]}
            </button>
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>
                {a.name}
                <span className={`${styles.chip} ${a.ai_enabled ? styles.chipOn : styles.chipOff}`}>
                  {a.ai_enabled ? "IA" : "solo manual / workflows"}
                </span>
                {a.kind === "audio" && a.as_voice_note && (
                  <span className={`${styles.chip} ${styles.chipStage}`}>nota de voz</span>
                )}
                {a.agent_id && <span className={`${styles.chip} ${styles.chipStage}`}>{agentName(a.agent_id)}</span>}
              </span>
              <span className={styles.hint}>
                {MEDIA_KIND_LABEL[a.kind]} · {formatBytes(a.size_bytes)}
                {a.description ? ` · ${a.description}` : " · sin condición: la IA no sabrá cuándo enviarlo"}
              </span>
            </div>
            <div className={styles.actions}>
              <button className={styles.ghostBtn} onClick={() => openPreview(a)} disabled={busy}>
                Ver
              </button>
              {isAdmin && (
                <>
                  <button className={styles.ghostBtn} onClick={() => toggleAi(a)} disabled={busy}>
                    {a.ai_enabled ? "Quitar de la IA" : "Dar a la IA"}
                  </button>
                  <button className={styles.ghostBtn} onClick={() => startEdit(a)} disabled={busy}>
                    Editar
                  </button>
                  <button className={styles.dangerBtn} onClick={() => remove(a)} disabled={busy}>
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {preview && (
        <div className={styles.modalBackdrop} onClick={() => setPreview(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <strong>{preview.asset.name}</strong>
              <button className={styles.ghostBtn} onClick={() => setPreview(null)}>
                Cerrar
              </button>
            </div>
            {preview.asset.kind === "audio" && <audio controls src={preview.url} className={styles.player} />}
            {preview.asset.kind === "video" && <video controls src={preview.url} className={styles.player} />}
            {preview.asset.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.asset.name} className={styles.player} />
            )}
            {preview.asset.kind === "document" && (
              <a className={styles.primaryBtn} href={preview.url} target="_blank" rel="noreferrer">
                Abrir documento
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
