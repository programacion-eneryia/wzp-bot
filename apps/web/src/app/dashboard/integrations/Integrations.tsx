"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./integrations.module.css";

type Urls = {
  lead_intake: string;
  ghl_lead: string;
  ghl_appointment: string;
  ghl_bot: string;
  ghl_send: string;
  manychat_dynamic: string;
};

type Integration = {
  intake_token: string;
  manychat_api_key: string | null;
  default_channel_id: string | null;
  proactive_enabled: boolean;
  ghl_webhook_url: string | null;
  urls: Urls;
};

type Channel = {
  id: string;
  provider: string;
  status?: string;
  display_name?: string | null;
};

type AppId = "ghl" | "manychat" | "webhook" | "outbound";

export default function Integrations({ isAdmin = true }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState<AppId | null>(null);
  const [data, setData] = useState<Integration | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [manychatKey, setManychatKey] = useState("");
  const [ghlWebhookUrl, setGhlWebhookUrl] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<Integration>("/api/integrations"),
      apiFetch<Channel[]>("/api/channels").catch(() => [] as Channel[]),
    ])
      .then(([integ, chs]) => {
        setData(integ);
        setManychatKey(integ.manychat_api_key ?? "");
        setGhlWebhookUrl(integ.ghl_webhook_url ?? "");
        setChannels(Array.isArray(chs) ? chs : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<Integration>("/api/integrations", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setData(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    if (!confirm("¿Generar un token nuevo? Las URLs antiguas dejarán de funcionar.")) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Integration>("/api/integrations/rotate-token", {
        method: "POST",
      });
      setData(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al rotar el token");
    } finally {
      setSaving(false);
    }
  }

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading) return <p className={styles.muted}>Cargando…</p>;
  if (!data) return <p className={styles.error}>{error ?? "No se pudo cargar"}</p>;

  const waChannels = channels.filter((c) => c.provider === "whatsapp");

  const apps: { id: AppId; name: string; text: string; status: string; ok: boolean; mark: string }[] = [
    {
      id: "ghl",
      name: "GoHighLevel",
      text: "Registra leads en el CRM, recibe citas agendadas y controla el bot desde tus workflows de GHL.",
      status: data.ghl_webhook_url ? "Conectado" : "Disponible",
      ok: Boolean(data.ghl_webhook_url),
      mark: "GHL",
    },
    {
      id: "manychat",
      name: "ManyChat",
      text: "Instagram vía flows de ManyChat: el bot responde dentro de tu flujo.",
      status: data.manychat_api_key ? "Conectado" : "Disponible",
      ok: Boolean(data.manychat_api_key),
      mark: "MC",
    },
    {
      id: "webhook",
      name: "Webhook genérico",
      text: "Cualquier formulario, CRM o herramienta (Zapier, Make, Meta Lead Ads…) que pueda hacer un POST.",
      status: "Disponible",
      ok: false,
      mark: "{ }",
    },
    {
      id: "outbound",
      name: "Canal de salida",
      text: "Qué número de WhatsApp usan los workflows para el primer contacto.",
      status: data.default_channel_id ? "Configurado" : "Automático",
      ok: true,
      mark: "WA",
    },
  ];

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.appGrid}>
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            className={`${styles.appCard} ${open === app.id ? styles.appCardOpen : ""}`}
            onClick={() => setOpen(open === app.id ? null : app.id)}
          >
            <div className={styles.appHead}>
              <span className={styles.appMark}>{app.mark}</span>
              <span className={`${styles.appStatus} ${app.ok ? styles.appStatusOn : ""}`}>
                {app.status}
              </span>
            </div>
            <span className={styles.appName}>{app.name}</span>
            <span className={styles.appText}>{app.text}</span>
            <span className={styles.appCta}>{open === app.id ? "Cerrar" : "Configurar →"}</span>
          </button>
        ))}
      </div>

      {open === "ghl" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>GoHighLevel</h2>
          {!isAdmin ? (
            <p className={styles.muted}>Solo un administrador puede ver los tokens y las URLs.</p>
          ) : (
            <>
              <p className={styles.muted}>
                Pega estas URLs en tus workflows de GHL como acción “Webhook (Outbound)” (POST).
                Llevan tu token secreto; trátalas como una contraseña.
              </p>
              <UrlRow
                label="① Registrar leads en el CRM"
                hint="ESTA es la URL para que un lead ENTRE al CRM. Workflow (trigger de nuevo lead) → “Webhook (Outbound)” (POST) a esta URL."
                url={data.urls.lead_intake}
                copied={copied === "generic"}
                onCopy={() => copy(data.urls.lead_intake, "generic")}
              />
              <UrlRow
                label="② Cita agendada/cancelada (NO usar para registrar leads)"
                hint="SOLO para eventos de cita. Trigger “Appointment (Booked/Cancelled)” → “Webhook (Outbound)”. Incluye el campo setter_id. Al recibirlo, el lead pasa a “Llamada agendada” y se pausan bot y seguimientos."
                url={data.urls.ghl_appointment}
                copied={copied === "ghl_appt"}
                onCopy={() => copy(data.urls.ghl_appointment, "ghl_appt")}
              />
              <UrlRow
                label="③ Pausar / reactivar el bot"
                hint='POST con JSON: {"action": "pause"} o {"action": "resume"}, más setter_id (o phone/contact_id).'
                url={data.urls.ghl_bot}
                copied={copied === "ghl_bot"}
                onCopy={() => copy(data.urls.ghl_bot, "ghl_bot")}
              />
              <UrlRow
                label="④ Enviar mensaje al lead por el bot"
                hint='POST con JSON: {"message": "tu texto"}, más setter_id (o phone/contact_id). Al enviarse, la IA se pausa (mensaje manual).'
                url={data.urls.ghl_send}
                copied={copied === "ghl_send"}
                onCopy={() => copy(data.urls.ghl_send, "ghl_send")}
              />

              <h3 className={styles.subTitle}>Respuesta de salida (setter_id)</h3>
              <p className={styles.muted}>
                Cuando entra un lead, devolvemos a GHL un webhook con el{" "}
                <code className={styles.code}>setter_id</code> y el{" "}
                <code className={styles.code}>ghl_contact_id</code>. Crea en GHL un Workflow con
                trigger <strong>“Inbound Webhook”</strong>, pega aquí su URL y añade una acción{" "}
                <strong>“Update Contact Field”</strong> guardando{" "}
                <code className={styles.code}>setter_id</code> en un campo personalizado.
              </p>
              <label className={styles.field}>
                <span className={styles.label}>URL del Inbound Webhook de GHL</span>
                <input
                  className={styles.input}
                  type="url"
                  value={ghlWebhookUrl}
                  onChange={(e) => setGhlWebhookUrl(e.target.value)}
                  placeholder="https://services.leadconnectorhq.com/hooks/…"
                />
              </label>
              <button
                className={styles.saveBtn}
                onClick={() => patch({ ghl_webhook_url: ghlWebhookUrl })}
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar URL de salida"}
              </button>
            </>
          )}
        </section>
      )}

      {open === "manychat" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>ManyChat (Instagram)</h2>
          {!isAdmin ? (
            <p className={styles.muted}>Solo un administrador puede ver los tokens y las URLs.</p>
          ) : (
            <>
              <UrlRow
                label="URL para el flow"
                hint="Flow → Dynamic Block / External Request (POST). El bot responde por IG dentro del flujo."
                url={data.urls.manychat_dynamic}
                copied={copied === "mc"}
                onCopy={() => copy(data.urls.manychat_dynamic, "mc")}
              />
              <label className={styles.field}>
                <span className={styles.label}>
                  API key de ManyChat{" "}
                  <span className={styles.hint}>— opcional, para enviar por IG fuera del flujo</span>
                </span>
                <input
                  className={styles.input}
                  type="password"
                  value={manychatKey}
                  onChange={(e) => setManychatKey(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
              <button
                className={styles.saveBtn}
                onClick={() => patch({ manychat_api_key: manychatKey })}
                disabled={saving}
              >
                {saving ? "Guardando…" : "Guardar API key"}
              </button>
            </>
          )}
        </section>
      )}

      {open === "webhook" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Webhook genérico</h2>
          {!isAdmin ? (
            <p className={styles.muted}>Solo un administrador puede ver los tokens y las URLs.</p>
          ) : (
            <>
              <UrlRow
                label="Registrar un lead"
                hint='POST con JSON. Campos: name, phone (con prefijo), email, source, campaign y cualquier campo extra del formulario. Ej: {"name":"Ana","phone":"+34600000000","source":"web"}'
                url={data.urls.lead_intake}
                copied={copied === "generic2"}
                onCopy={() => copy(data.urls.lead_intake, "generic2")}
              />
              <div className={styles.tokenRow}>
                <span className={styles.muted}>
                  Token: <code className={styles.code}>{data.intake_token}</code>
                </span>
                <button className={styles.ghostBtn} onClick={rotate} disabled={saving}>
                  Generar token nuevo
                </button>
              </div>
              <p className={styles.hint}>
                Si generas un token nuevo, todas las URLs anteriores (GHL, ManyChat, este webhook)
                dejan de funcionar y hay que volver a pegarlas.
              </p>
            </>
          )}
        </section>
      )}

      {open === "outbound" && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Canal de salida (WhatsApp)</h2>
          <label className={styles.field}>
            <span className={styles.label}>
              Canal de WhatsApp para el primer contacto de los workflows
            </span>
            <select
              className={styles.input}
              value={data.default_channel_id ?? ""}
              onChange={(e) => patch({ default_channel_id: e.target.value })}
              disabled={saving}
            >
              <option value="">Automático (primer WhatsApp conectado)</option>
              {waChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name ?? c.id} {c.status ? `· ${c.status}` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.muted}>
            El primer mensaje y los seguimientos se definen en <strong>Workflows</strong> (“Cuando
            entra un lead” / “Conversación nueva”). Usa variables como {"{name}"}.
          </p>
        </section>
      )}
    </div>
  );
}

function UrlRow({
  label,
  hint,
  url,
  copied,
  onCopy,
}: {
  label: string;
  hint: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={styles.urlRow}>
      <div className={styles.urlHead}>
        <span className={styles.urlLabel}>{label}</span>
        <button className={styles.copyBtn} onClick={onCopy}>
          {copied ? "Copiado ✓" : "Copiar"}
        </button>
      </div>
      <code className={styles.url}>{url}</code>
      <span className={styles.hint}>{hint}</span>
    </div>
  );
}
