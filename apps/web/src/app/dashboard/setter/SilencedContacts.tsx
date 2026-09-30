"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, apiUpload } from "@/lib/api";
import styles from "./setter.module.css";

type Silenced = { id: string; identifier: string; created_at: string };

export default function SilencedContacts() {
  const [items, setItems] = useState<Silenced[]>([]);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setItems(await apiFetch<Silenced[]>("/api/setter/silenced"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function importCsv(file: File) {
    setBusy(true);
    setError(null);
    setImportMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await apiUpload<{ total: number; imported: number; skipped: number }>(
        "/api/setter/silenced/import",
        form,
      );
      setImportMsg(
        `Importados ${r.imported} de ${r.total}${r.skipped ? ` (${r.skipped} omitidos por repetidos o inválidos)` : ""}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function downloadTemplate() {
    const csv = "contacto\n+34600000000\n@usuario_instagram\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "silenciados-plantilla.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function add() {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<Silenced>("/api/setter/silenced", {
        method: "POST",
        body: JSON.stringify({ identifier: value.trim() }),
      });
      setItems((prev) => [created, ...prev.filter((i) => i.id !== created.id)]);
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/setter/silenced/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Contactos silenciados</h2>
      <p className={styles.aiText}>La IA nunca responderá a estos contactos (teléfono o @usuario).</p>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.row}>
        <input
          className={styles.input}
          placeholder="+34612345678 o @usuario_instagram"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className={styles.saveBtn} onClick={add} disabled={busy}>
          {busy ? "…" : "Añadir"}
        </button>
      </div>
      <div className={styles.row} style={{ alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCsv(f);
          }}
        />
        <button
          className={styles.aiBtnGhost}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Importar CSV
        </button>
        <button className={styles.aiBtnGhost} onClick={downloadTemplate} type="button">
          Descargar plantilla
        </button>
        <span className={styles.muted}>
          Una columna con teléfono (con prefijo) o @usuario de Instagram; una fila por contacto.
        </span>
      </div>
      {importMsg && <p className={styles.muted}>{importMsg}</p>}
      {items.length === 0 ? (
        <p className={styles.muted}>No hay contactos silenciados.</p>
      ) : (
        <ul className={styles.silencedList}>
          {items.map((i) => (
            <li key={i.id} className={styles.silencedRow}>
              <span>{i.identifier}</span>
              <button className={styles.del} onClick={() => remove(i.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
