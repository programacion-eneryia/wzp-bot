"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { getTheme, applyTheme, type Theme } from "@/lib/theme";
import styles from "../agents/agents.module.css";

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_platform_admin: boolean;
  created_at: string;
};

export default function Profile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getTheme());
    apiFetch<Profile>("/api/me/profile")
      .then((p) => {
        setProfile(p);
        setName(p?.full_name ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const p = await apiFetch<Profile>("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify({ full_name: name.trim() || null }),
      });
      setProfile(p);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (pw1.length < 8) {
      setPwMsg("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg("Las contraseñas no coinciden.");
      return;
    }
    setPwBusy(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.updateUser({ password: pw1 });
      if (err) throw err;
      setPw1("");
      setPw2("");
      setPwMsg("Contraseña actualizada ✓");
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : "No se pudo cambiar la contraseña");
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className={styles.wrap} style={{ maxWidth: 720 }}>
      <div>
        <span className={styles.eyebrow}>Cuenta</span>
        <h1 className={styles.title}>Mi perfil</h1>
        <p className={styles.lead}>Tu nombre, tu contraseña y cómo ves la aplicación.</p>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Datos</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Nombre</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              placeholder="Tu nombre"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input className={styles.input} value={profile?.email ?? ""} disabled />
          </label>
        </div>
        <div className={styles.footer} style={{ position: "static", padding: 0 }}>
          <button className={styles.primaryBtn} onClick={save} disabled={saving || !profile}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {saved && <span className={styles.savedMsg}>Guardado ✓</span>}
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Apariencia</h2>
        <div className={styles.row}>
          <button
            className={theme === "dark" ? styles.primaryBtn : styles.ghostBtn}
            onClick={() => {
              applyTheme("dark");
              setTheme("dark");
            }}
            type="button"
          >
            ☾ Modo noche
          </button>
          <button
            className={theme === "light" ? styles.primaryBtn : styles.ghostBtn}
            onClick={() => {
              applyTheme("light");
              setTheme("light");
            }}
            type="button"
          >
            ☼ Modo día
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Cambiar contraseña</h2>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Nueva contraseña</span>
            <input
              className={styles.input}
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Repetir contraseña</span>
            <input
              className={styles.input}
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className={styles.footer} style={{ position: "static", padding: 0 }}>
          <button className={styles.ghostBtn} onClick={changePassword} disabled={pwBusy}>
            {pwBusy ? "Cambiando…" : "Cambiar contraseña"}
          </button>
          {pwMsg && <span className={styles.muted}>{pwMsg}</span>}
        </div>
      </section>
    </div>
  );
}
