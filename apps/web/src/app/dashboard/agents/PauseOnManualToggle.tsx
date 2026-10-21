"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./agents.module.css";

/** Ajuste de la cuenta (lo comparten todos los agentes); se guarda al marcarlo. */
export default function PauseOnManualToggle({ isAdmin }: { isAdmin: boolean }) {
  const [value, setValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ pause_on_manual?: boolean }>("/api/setter/config")
      .then((c) => setValue(c.pause_on_manual !== false))
      .catch(() => setValue(true));
  }, []);

  async function toggle(next: boolean) {
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/setter/config", {
        method: "PUT",
        body: JSON.stringify({ pause_on_manual: next }),
      });
    } catch (e) {
      setValue(prev);
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={value ?? true}
          disabled={value === null || saving || !isAdmin}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <strong>Pausar la IA cuando una persona escribe a mano</strong> — al escribir tú en un chat
          (desde Chats o desde el móvil), la IA de ese chat se pausa. No la pausan la plantilla de
          primer contacto de GHL ni los mensajes enviados con el webhook de GHL. Se aplica a todos
          los agentes.
        </span>
      </label>
      {error && <div className={styles.error}>{error}</div>}
    </>
  );
}
