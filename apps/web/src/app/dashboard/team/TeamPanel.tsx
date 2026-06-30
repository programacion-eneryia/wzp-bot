"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "../admin/admin.module.css";

type Member = {
  user_id: string;
  role: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
};

export default function TeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [role, setRole] = useState("closer");

  const load = useCallback(async () => {
    setMembers(await apiFetch<Member[]>("/api/team/members"));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function create() {
    if (!email.trim() || !pass.trim()) {
      setError("Email y contraseña son obligatorios");
      return;
    }
    void run(async () => {
      await apiFetch("/api/team/members", {
        method: "POST",
        body: JSON.stringify({ email, password: pass, role }),
      });
      setEmail("");
      setPass("");
    });
  }

  function toggleRole(m: Member) {
    const next = m.role === "admin" ? "closer" : "admin";
    void run(() =>
      apiFetch(`/api/team/members/${m.user_id}/role`, {
        method: "POST",
        body: JSON.stringify({ role: next }),
      }),
    );
  }

  function resetPw(m: Member) {
    const password = prompt(`Nueva contraseña para ${m.email}:`);
    if (!password) return;
    void run(() =>
      apiFetch(`/api/team/members/${m.user_id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    );
  }

  function remove(m: Member) {
    if (!confirm(`Quitar a ${m.email} de la organización?`)) return;
    void run(() => apiFetch(`/api/team/members/${m.user_id}`, { method: "DELETE" }));
  }

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Añadir usuario</h2>
        <div className={styles.formRow}>
          <input className={styles.input} placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={styles.input} placeholder="contraseña" value={pass} onChange={(e) => setPass(e.target.value)} />
          <select className={styles.input} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="closer">closer</option>
            <option value="admin">admin</option>
          </select>
          <button className={styles.saveBtn} onClick={create} disabled={busy}>
            Crear
          </button>
        </div>
      </section>

      <ul className={styles.list}>
        {members.map((m) => (
          <li key={m.user_id} className={styles.item}>
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>
                {m.email} <span className={styles.badge}>{m.role}</span>
              </span>
              <span className={styles.hint}>{m.full_name ?? ""}</span>
            </div>
            <div className={styles.actions}>
              <button className={styles.ghostBtn} onClick={() => toggleRole(m)} disabled={busy}>
                {m.role === "admin" ? "Hacer closer" : "Hacer admin"}
              </button>
              <button className={styles.ghostBtn} onClick={() => resetPw(m)} disabled={busy}>
                Reset pass
              </button>
              <button className={styles.dangerBtn} onClick={() => remove(m)} disabled={busy}>
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
