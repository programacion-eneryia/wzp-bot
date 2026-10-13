"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUpload } from "@/lib/api";
import { invalidateAgents, type Agent } from "@/lib/agents";
import { invalidateStages } from "@/lib/stages";
import styles from "./setter.module.css";

/**
 * Base de Conocimiento: la información del negocio que comparten todos los
 * agentes. Los ajustes de la IA viven en Agentes (generales y por agente).
 */
type SetterConfig = {
  company_name: string | null;
  summary: string | null;
  promise: string | null;
  offer: string | null;
  product: string | null;
  social_proof: string | null;
  pricing_links: string | null;
  team: string | null;
  knowledge_base: string | null;
  proactive_template: string | null;
};

const BUSINESS_KEYS: (keyof SetterConfig)[] = [
  "company_name",
  "summary",
  "promise",
  "offer",
  "product",
  "social_proof",
  "pricing_links",
  "team",
  "knowledge_base",
  "proactive_template",
];

type BriefResult = {
  config: SetterConfig;
  setter?: Agent;
  support?: Agent;
  created_tags?: string[];
  created_stages?: string[];
  extractedChars?: number;
  files?: number;
};

export default function SetterForm() {
  const [cfg, setCfg] = useState<SetterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      const payload: Record<string, unknown> = {};
      for (const k of BUSINESS_KEYS) payload[k] = cfg[k];
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

  function describeResult(r: BriefResult): string {
    const parts: string[] = [];
    if (r.files) {
      parts.push(
        `${r.files} documento(s) leídos (${(r.extractedChars ?? 0).toLocaleString()} caracteres)`,
      );
    }
    parts.push("Base de Conocimiento actualizada");
    const agents = [r.setter?.name, r.support?.name].filter(Boolean) as string[];
    if (agents.length) parts.push(`agentes configurados: ${agents.join(" y ")}`);
    if (r.created_tags?.length) parts.push(`etiquetas nuevas: ${r.created_tags.join(", ")}`);
    if (r.created_stages?.length) parts.push(`etapas nuevas: ${r.created_stages.join(", ")}`);
    return parts.join(" · ") + ".";
  }

  function applyResult(r: BriefResult) {
    setCfg(r.config);
    setBrief(r.config.knowledge_base ?? "");
    setUploadInfo(describeResult(r));
    setSaved(true);
    invalidateAgents();
    invalidateStages();
  }

  async function generate() {
    if (!brief.trim()) {
      setError("Pega primero el brief de tu negocio");
      return;
    }
    setGenerating(true);
    setError(null);
    setUploadInfo(null);
    try {
      const r = await apiFetch<BriefResult>("/api/setter/generate", {
        method: "POST",
        body: JSON.stringify({ brief, apply: true }),
      });
      applyResult(r);
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
      const r = await apiUpload<BriefResult>("/api/setter/generate-from-file", form);
      applyResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al leer los documentos");
    } finally {
      setGenerating(false);
      if (fileRef.current) fileRef.current.value = "";
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
          <h2 className={styles.cardTitle}>✨ Generar todo desde tu brief</h2>
          <p className={styles.aiText}>
            Pega el brief de tu negocio (oferta, casos, FAQs, objeciones… todo). La IA rellena
            esta Base de Conocimiento y configura tus agentes <strong>Setter</strong> y{" "}
            <strong>Soporte</strong> (identidad, fases, criterios, tono, reglas). También
            propone etiquetas y etapas. Luego ajustas lo que quieras.
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
        {uploadInfo && (
          <p className={styles.savedMsg}>
            {uploadInfo}{" "}
            <Link href="/dashboard/agents" style={{ color: "inherit" }}>
              Ver agentes →
            </Link>
          </p>
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Tu negocio</h2>
            <p className={styles.muted}>
              Esta información la comparten todos tus agentes. La personalidad, el objetivo y las
              reglas de cada uno se editan en{" "}
              <Link href="/dashboard/agents" style={{ color: "inherit" }}>
                Agentes
              </Link>
              .
            </p>
            <label className={styles.field}>
              <span className={styles.label}>Empresa</span>
              <input
                className={styles.input}
                value={cfg.company_name ?? ""}
                onChange={(e) => set("company_name", e.target.value)}
              />
            </label>
            {area("summary", "Resumen", 2, "qué hace la empresa en dos líneas")}
            {area("promise", "Promesa principal", 2)}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Qué ofrece</h2>
            {area("offer", "Oferta principal", 3)}
            {area("product", "Producto / servicio", 3)}
            {area("social_proof", "Prueba social", 3, "casos de éxito, resultados")}
            {area("pricing_links", "Precios y enlaces", 2)}
            {area("team", "Equipo", 2)}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Conocimiento completo</h2>
            {area(
              "knowledge_base",
              "Brief / conocimiento del negocio",
              10,
              "todo lo que los agentes deben saber: oferta, FAQs, objeciones, procesos…",
            )}
            {area(
              "proactive_template",
              "Primer mensaje a leads que entran por formulario",
              3,
              "opcional; puedes usar {name}",
              "Hola {name}! Vi que te interesaste en… ¿te viene bien que te cuente cómo funciona?",
            )}
          </section>

      <div className={styles.actions}>
        <button className={styles.saveBtn} onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved && <span className={styles.savedMsg}>Guardado ✓</span>}
      </div>
    </div>
  );
}
