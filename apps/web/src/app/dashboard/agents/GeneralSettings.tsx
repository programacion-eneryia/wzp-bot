"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { MODEL_CHOICES, timezoneOptions } from "@/lib/ai-options";
import type { Agent } from "@/lib/agents";
import SilencedContacts from "../setter/SilencedContacts";
import PauseOnManualToggle from "./PauseOnManualToggle";
import styles from "./agents.module.css";

/** Ajustes de comportamiento de la cuenta (setter_configs) que heredan los agentes. */
type GeneralConfig = {
  is_active: boolean;
  multi_bubble: boolean;
  first_reply_min_s: number;
  first_reply_max_s: number;
  typing_cps: number;
  active_hours_enabled: boolean;
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  ignore_followed: boolean;
  model: string | null;
  daily_token_limit: number;
};

const KEYS: (keyof GeneralConfig)[] = [
  "is_active",
  "multi_bubble",
  "first_reply_min_s",
  "first_reply_max_s",
  "typing_cps",
  "active_hours_enabled",
  "active_hours_start",
  "active_hours_end",
  "timezone",
  "ignore_followed",
];
const ADMIN_KEYS: (keyof GeneralConfig)[] = ["model", "daily_token_limit"];

type Props = {
  agents: Agent[];
  isAdmin: boolean;
  /** Cambia qué agente es el predeterminado (null = ninguno → IA pausada). */
  onSetDefault: (kind: "lead" | "conversation", agentId: string | null) => Promise<void>;
};

export default function GeneralSettings({ agents, isAdmin, onSetDefault }: Props) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<GeneralConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || cfg) return;
    apiFetch<GeneralConfig>("/api/setter/config")
      .then(setCfg)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [open, cfg]);

  function set<K extends keyof GeneralConfig>(key: K, value: GeneralConfig[K]) {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const k of [...KEYS, ...(isAdmin ? ADMIN_KEYS : [])]) payload[k] = cfg[k];
      const updated = await apiFetch<GeneralConfig>("/api/setter/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setCfg(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const active = agents.filter((a) => a.is_active);
  const defLead = agents.find((a) => a.is_default_lead) ?? null;
  const defConv = agents.find((a) => a.is_default_conversation) ?? null;

  return (
    <section className={styles.card}>
      <button type="button" className={styles.collapseHead} onClick={() => setOpen((v) => !v)}>
        <span>
          <strong>Ajustes generales</strong>
          <span className={styles.muted}>
            {" "}
            — agentes por defecto, interruptor de la IA y ajustes que heredan todos los agentes
          </span>
        </span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Agente para leads nuevos (formularios, GHL, webhooks)</span>
          <select
            className={styles.select}
            value={defLead?.id ?? ""}
            disabled={!isAdmin}
            onChange={(e) => void onSetDefault("lead", e.target.value || null)}
          >
            <option value="">Ninguno — entran con la IA pausada</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Agente para conversaciones nuevas (te escriben)</span>
          <select
            className={styles.select}
            value={defConv?.id ?? ""}
            disabled={!isAdmin}
            onChange={(e) => void onSetDefault("conversation", e.target.value || null)}
          >
            <option value="">Ninguno — entran con la IA pausada</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.muted}>
        Si un canal tiene un agente asignado, las conversaciones nuevas de ese canal las atiende ese
        agente. Sin agente predeterminado, la IA se activa a mano desde Chats, con un workflow
        (&quot;Pasar a IA&quot;) o desde GoHighLevel.
      </p>
      <PauseOnManualToggle isAdmin={isAdmin} />

      {open && error && <div className={styles.error}>{error}</div>}
      {open && !cfg && !error && <p className={styles.muted}>Cargando…</p>}
      {open && cfg && (
        <>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={cfg.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
            <span>
              <strong>IA activada</strong> — interruptor maestro. Si se apaga, ningún agente
              responde.
            </span>
          </label>

          <h3 className={styles.subTitle}>Ajustes por defecto de los agentes</h3>
          <p className={styles.muted}>
            Cada agente puede sobreescribirlos en su pestaña &quot;Ajustes de IA&quot;.
          </p>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={cfg.multi_bubble}
              onChange={(e) => set("multi_bubble", e.target.checked)}
            />
            <span>Dividir respuestas en varias burbujas (más humano)</span>
          </label>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={cfg.ignore_followed}
              onChange={(e) => set("ignore_followed", e.target.checked)}
            />
            <span>No responder a cuentas que sigues (Instagram)</span>
          </label>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>Tiempo mín. en contestar (seg)</span>
              <input
                type="number"
                className={styles.input}
                value={cfg.first_reply_min_s}
                onChange={(e) => set("first_reply_min_s", Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Tiempo máx. en contestar (seg)</span>
              <input
                type="number"
                className={styles.input}
                value={cfg.first_reply_max_s}
                onChange={(e) => set("first_reply_max_s", Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Velocidad de escritura (car./seg)</span>
              <input
                type="number"
                className={styles.input}
                value={cfg.typing_cps}
                onChange={(e) => set("typing_cps", Number(e.target.value))}
              />
            </label>
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={cfg.active_hours_enabled}
              onChange={(e) => set("active_hours_enabled", e.target.checked)}
            />
            <span>Responder solo dentro de un horario</span>
          </label>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>Inicio (hora, 0-23)</span>
              <input
                type="number"
                className={styles.input}
                value={cfg.active_hours_start}
                onChange={(e) => set("active_hours_start", Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Fin (hora, 0-23)</span>
              <input
                type="number"
                className={styles.input}
                value={cfg.active_hours_end}
                onChange={(e) => set("active_hours_end", Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Zona horaria</span>
              <select
                className={styles.select}
                value={cfg.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                {!timezoneOptions().includes(cfg.timezone) && cfg.timezone && (
                  <option value={cfg.timezone}>{cfg.timezone}</option>
                )}
                {timezoneOptions().map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isAdmin && (
            <>
              <h3 className={styles.subTitle}>Modelo y coste</h3>
              <div className={styles.row}>
                <label className={styles.field}>
                  <span className={styles.label}>Modelo LLM por defecto</span>
                  <select
                    className={styles.select}
                    value={cfg.model ?? ""}
                    onChange={(e) => set("model", e.target.value || null)}
                  >
                    <option value="">Por defecto — Claude Sonnet 4.6 (recomendado)</option>
                    {MODEL_CHOICES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Límite de tokens de IA por día (0 = sin límite)</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    step={10000}
                    value={cfg.daily_token_limit ?? 0}
                    onChange={(e) => set("daily_token_limit", Number(e.target.value))}
                  />
                </label>
              </div>
            </>
          )}

          <div className={styles.footerInline}>
            <button className={styles.primaryBtn} onClick={save} disabled={saving || !isAdmin}>
              {saving ? "Guardando…" : "Guardar ajustes generales"}
            </button>
            {saved && <span className={styles.savedMsg}>Guardado ✓</span>}
          </div>

          <SilencedContacts />
        </>
      )}
    </section>
  );
}
