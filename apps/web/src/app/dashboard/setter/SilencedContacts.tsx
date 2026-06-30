"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./setter.module.css";

type Silenced = { id: string; identifier: string; created_at: string };

export default function SilencedContacts() {
  const [items, setItems] = useState<Silenced[]>([]);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Silenced[]>("/api/setter/silenced")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

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
