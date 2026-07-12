"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiUpload } from "@/lib/api";
import SilencedContacts from "./SilencedContacts";
import styles from "./setter.module.css";

type SetterConfig = {
  setter_name: string;
  identity_role: string;
  company_name: string | null;
  offer: string | null;
  knowledge_base: string | null;
  objective: string;
  qualification_criteria: string | null;
  tone: string;
  rules: string | null;
  summary: string | null;
  promise: string | null;
  funnel_phases: string | null;
  conversation_types: string | null;
  best_practices: string | null;
  product: string | null;
  team: string | null;
  social_proof: string | null;
  pricing_links: string | null;
  special_cases: string | null;
  followups: string | null;
  support_enabled: boolean;
  support_objective: string | null;
  support_instructions: string | null;
  proactive_template: string | null;
  winning_examples: string | null;
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
  is_active: boolean;
};

// Modelos permitidos (deben coincidir con ALLOWED_MODELS del backend).
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Por defecto — Claude Sonnet 4.6 (recomendado)" },
  { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (rápido/barato)" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini (rápido/barato)" },
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
];

// Zonas horarias frecuentes (España + Latinoamérica). Si el navegador soporta
// la lista completa IANA, la usamos; si no, caemos a esta selección.
const COMMON_TIMEZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Costa_Rica",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/New_York",
  "UTC",
];

function timezoneOptions(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (Array.isArray(all) && all.length > 0) return all;
  } catch {
    // navegador sin soporte → lista común
  }
  return COMMON_TIMEZONES;
}

type Tab = "business" | "conversation" | "support" | "learn" | "ai" | "silenced";

const TABS: { id: Tab; label: string }[] = [
  { id: "business", label: "Negocio" },
  { id: "conversation", label: "Conversación" },
  { id: "support", label: "Soporte" },
  { id: "learn", label: "Aprendizaje" },
  { id: "ai", label: "Ajustes de IA" },
  { id: "silenced", label: "Silenciados" },
];

export default function SetterForm() {
  const [cfg, setCfg] = useState<SetterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>("business");

  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const examplesRef = useRef<HTMLInputElement>(null);
  const [examplesInfo, setExamplesInfo] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<SetterConfig>("/api/setter/config")
      .then((c) => {
        setCfg(c);
        setBrief(c.knowledge_base ?? "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const set = useCallback(
    <K extends keyof SetterConfig>(key: K, value: SetterConfig[K]) => {
      setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
      setSaved(false);
    },
    [],
  );

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setError(null);
    try {
      // Quitamos campos gestionados por el servidor (el validador los rechaza).
      const payload = { ...cfg } as Record<string, unknown>;
      delete payload.organization_id;
      delete payload.updated_at;
      const updated = await apiFetch<SetterConfig>("/api/setter/config", {
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

  async function generate() {
    if (!brief.trim()) {
      setError("Pega primero el brief de tu negocio");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const { config } = await apiFetch<{ config: SetterConfig }>("/api/setter/generate", {
        method: "POST",
        body: JSON.stringify({ brief, apply: true }),
      });
      setCfg(config);
      setSaved(true);
      setTab("business");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setGenerating(false);
    }
  }

  async function uploadDocs(files: FileList) {
    setGenerating(true);
    setError(null);
    setUploadInfo(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      form.append("apply", "true");
      const { config, extractedChars, files: count } = await apiUpload<{
        config: SetterConfig;
        extractedChars: number;
        files: number;
      }>("/api/setter/generate-from-file", form);
      setCfg(config);
      setBrief(config.knowledge_base ?? "");
      setUploadInfo(
        `${count} documento(s) leídos (${extractedChars.toLocaleString()} caracteres) y campos rellenados.`,
      );
      setSaved(true);
      setTab("business");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al leer los documentos");
    } finally {
      setGenerating(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function uploadExamples(files: FileList) {
    setGenerating(true);
    setError(null);
    setExamplesInfo(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      form.append("append", "true");
      const { config, extractedChars, files: count } = await apiUpload<{
        config: SetterConfig;
        extractedChars: number;
        files: number;
      }>("/api/setter/examples-from-file", form);
      setCfg(config);
      setExamplesInfo(
        `${count} conversación(es) añadidas (${extractedChars.toLocaleString()} caracteres). El bot aprenderá de ellas.`,
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al leer las conversaciones");
    } finally {
      setGenerating(false);
      if (examplesRef.current) examplesRef.current.value = "";
    }
  }

  if (loading) return <p className={styles.muted}>Cargando configuración…</p>;
  if (!cfg) return <p className={styles.error}>{error ?? "No se pudo cargar"}</p>;

  const area = (
    key: keyof SetterConfig,
    label: string,
    rows = 3,
    hint?: string,
    placeholder?: string,
  ) => (
    <label className={styles.field}>
      <span className={styles.label}>
        {label}
        {hint && <span className={styles.hint}> — {hint}</span>}
      </span>
      <textarea
        className={styles.textarea}
        rows={rows}
        value={(cfg[key] as string | null) ?? ""}
        onChange={(e) => set(key, e.target.value as never)}
        placeholder={placeholder}
      />
    </label>
  );

  return (
    <div className={styles.form}>
      {/* Panel de generación con IA */}
      <section className={styles.aiPanel}>
        <div className={styles.aiHead}>
          <h2 className={styles.cardTitle}>✨ Generar con IA desde tu brief</h2>
          <p className={styles.aiText}>
            Pega aquí el brief de tu negocio (oferta, casos, FAQs, todo). La IA
            redactará identidad, fases, cualificación, reglas, tono y más. Luego lo ajustas.
          </p>
        </div>
        <textarea
          className={styles.textarea}
          rows={6}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Ej: Somos una consultoría B2B que ayuda a agencias a sistematizar su captación… (cuanto más, mejor)"
        />
        <div className={styles.aiActions}>
          <button className={styles.aiBtn} onClick={generate} disabled={generating}>
            {generating ? "Analizando…" : "Generar desde el texto"}
          </button>
          <span className={styles.aiOr}>o</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className={styles.fileInput}
            onChange={(e) => {
              const fs = e.target.files;
              if (fs && fs.length > 0) uploadDocs(fs);
            }}
            disabled={generating}
          />
          <button
            type="button"
            className={styles.aiBtnGhost}
            onClick={() => fileRef.current?.click()}
            disabled={generating}
          >
            Subir PDF o Word (varios)
          </button>
        </div>
        {generating && (
          <p className={styles.aiText}>
            La IA está leyendo y analizando el contenido. Puede tardar unos segundos…
          </p>
        )}
        {uploadInfo && <p className={styles.savedMsg}>{uploadInfo}</p>}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "business" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Identidad</h2>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Nombre del setter</span>
                <input
                  className={styles.input}
                  value={cfg.setter_name}
                  onChange={(e) => set("setter_name", e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Empresa</span>
                <input
                  className={styles.input}
                  value={cfg.company_name ?? ""}
                  onChange={(e) => set("company_name", e.target.value)}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Rol / quién es</span>
              <input
                className={styles.input}
                value={cfg.identity_role}
                onChange={(e) => set("identity_role", e.target.value)}
              />
            </label>
            {area("summary", "Resumen", 2, "una visión rápida del setter")}
            {area("promise", "Promesa principal", 2)}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Qué ofrece</h2>
            {area("offer", "Oferta principal", 3)}
            {area("product", "Producto / servicio", 3)}
            {area("social_proof", "Prueba social", 3, "casos de éxito, resultados")}
            {area("pricing_links", "Precios y enlaces", 2)}
            {area("team", "Equipo", 2)}
            {area(
              "knowledge_base",
              "Brief / conocimiento del negocio",
              8,
              "pega aquí todo: oferta, FAQs, objeciones…",
            )}
          </section>
        </>
      )}

      {tab === "conversation" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Cómo conversa</h2>
          {area("objective", "Objetivo", 2)}
          {area("qualification_criteria", "Criterios de cualificación", 4)}
          {area("funnel_phases", "Fases del embudo", 6, "apertura → cualificar → … → cierre")}
          {area("conversation_types", "Tipos de conversación", 4)}
          {area("special_cases", "Casos especiales", 4)}
          {area("followups", "Seguimiento", 3, "qué hacer si no responde")}
          {area("best_practices", "Buenas prácticas", 4)}
          {area("tone", "Tono y estilo", 2)}
          {area("rules", "Reglas y límites", 3, "qué NO hacer")}
        </section>
      )}

      {tab === "support" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Cerebro de Soporte</h2>
            <p className={styles.muted}>
              Para conversaciones con clientes/contactos ya existentes. El bot da soporte y,
              si detecta interés real de compra, escala a setter (cualifica y ofrece llamada).
              Usa el mismo conocimiento del negocio de la pestaña Negocio.
            </p>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={cfg.support_enabled}
                onChange={(e) => set("support_enabled", e.target.checked)}
              />
              <span>
                <strong>Modo soporte activado</strong> — permite que el bot responda en
                conversaciones clasificadas como soporte.
              </span>
            </label>
            {area(
              "support_objective",
              "Objetivo en soporte",
              3,
              "qué debe lograr al dar soporte",
            )}
            {area(
              "support_instructions",
              "Instrucciones de soporte",
              5,
              "cómo atender, qué puede resolver, cuándo escalar a llamada",
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Mensaje proactivo (primer contacto)</h2>
            <p className={styles.muted}>
              Plantilla para abrir conversación con un lead nuevo. Puedes usar variables como{" "}
              {"{nombre}"}. En WhatsApp normalmente el lead escribe primero (reglas de Meta).
            </p>
            {area(
              "proactive_template",
              "Plantilla del primer mensaje",
              3,
              "ej: hola {nombre}, vi que te interesó…",
            )}
          </section>
        </>
      )}

      {tab === "learn" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Aprender de conversaciones que funcionaron</h2>
          <p className={styles.muted}>
            Sube conversaciones antiguas que salieron bien (cerraron o agendaron llamada).
            El bot aprenderá su estilo, el orden de las preguntas y la forma de cerrar, para
            llevar las nuevas conversaciones igual. Puedes subir varias; se acumulan.
          </p>
          <div className={styles.aiActions}>
            <input
              ref={examplesRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className={styles.fileInput}
              onChange={(e) => {
                const fs = e.target.files;
                if (fs && fs.length > 0) uploadExamples(fs);
              }}
              disabled={generating}
            />
            <button
              type="button"
              className={styles.aiBtnGhost}
              onClick={() => examplesRef.current?.click()}
              disabled={generating}
            >
              Subir conversaciones (PDF, Word o TXT)
            </button>
          </div>
          {examplesInfo && <p className={styles.savedMsg}>{examplesInfo}</p>}
          <label className={styles.field} style={{ marginTop: 12 }}>
            <span className={styles.label}>
              Conversaciones de ejemplo
              <span className={styles.hint}> — puedes pegarlas o editarlas a mano</span>
            </span>
            <textarea
              className={styles.textarea}
              rows={12}
              value={cfg.winning_examples ?? ""}
              onChange={(e) => set("winning_examples", e.target.value)}
              placeholder="LEAD: hola, vi el anuncio...&#10;SETTER: hola! cuéntame, ¿qué te llamó la atención?..."
            />
          </label>
        </section>
      )}

      {tab === "ai" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Comportamiento</h2>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={cfg.is_active}
                onChange={(e) => set("is_active", e.target.checked)}
              />
              <span>
                <strong>IA activada</strong> — interruptor maestro. Si se apaga, deja de responder a todos.
              </span>
            </label>
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
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Tiempos (para sonar humano)</h2>
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
            </div>
            <label className={styles.field}>
              <span className={styles.label}>
                Velocidad de escritura <span className={styles.hint}>— caracteres por segundo (3-5 recomendado)</span>
              </span>
              <input
                type="number"
                className={styles.input}
                value={cfg.typing_cps}
                onChange={(e) => set("typing_cps", Number(e.target.value))}
              />
            </label>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Horario de respuesta</h2>
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
            </div>
            <label className={styles.field}>
              <span className={styles.label}>
                Zona horaria <span className={styles.hint}>— determina el horario activo</span>
              </span>
              <select
                className={styles.input}
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
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Modelo</h2>
            <label className={styles.field}>
              <span className={styles.label}>Modelo LLM</span>
              <select
                className={styles.input}
                value={cfg.model ?? ""}
                onChange={(e) => set("model", e.target.value || null)}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Control de coste</h2>
            <label className={styles.field}>
              <span className={styles.label}>
                Límite de tokens de IA por día{" "}
                <span className={styles.hint}>— 0 = sin límite. Al superarlo, el bot deja de responder hasta el día siguiente.</span>
              </span>
              <input
                className={styles.input}
                type="number"
                min={0}
                step={10000}
                value={cfg.daily_token_limit ?? 0}
                onChange={(e) => set("daily_token_limit", Number(e.target.value))}
                placeholder="0"
              />
            </label>
          </section>
        </>
      )}

      {tab === "silenced" && <SilencedContacts />}

      {tab !== "silenced" && (
        <div className={styles.actions}>
          <button className={styles.saveBtn} onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          {saved && <span className={styles.savedMsg}>Guardado ✓</span>}
        </div>
      )}
    </div>
  );
}
