"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAgents } from "@/lib/agents";
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
  ghl_api_token_set?: boolean;
  ghl_location_id?: string | null;
  ghl_setter_field?: string | null;
  ghl_sync_chat_leads?: boolean;
  ghl_chat_tags?: string[];
  ghl_chat_source?: string;
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
  const { agents } = useAgents();
  const [intakeAgent, setIntakeAgent] = useState("");
  const [ghlToken, setGhlToken] = useState("");
  const [ghlLocation, setGhlLocation] = useState("");
  const [ghlSetterField, setGhlSetterField] = useState("");
  const [ghlSync, setGhlSync] = useState(true);
  const [ghlTags, setGhlTags] = useState("setter-ia");
  const [ghlSource, setGhlSource] = useState("Setter IA (chat)");

  useEffect(() => {
    Promise.all([
      apiFetch<Integration>("/api/integrations"),
      apiFetch<Channel[]>("/api/channels").catch(() => [] as Channel[]),
    ])
      .then(([integ, chs]) => {
        setData(integ);
        setManychatKey(integ.manychat_api_key ?? "");
        setGhlWebhookUrl(integ.ghl_webhook_url ?? "");
        setGhlLocation(integ.ghl_location_id ?? "");
        setGhlSetterField(integ.ghl_setter_field ?? "");
        setGhlSync(integ.ghl_sync_chat_leads ?? true);
        setGhlTags((integ.ghl_chat_tags ?? ["setter-ia"]).join(", "));
        setGhlSource(integ.ghl_chat_source ?? "Setter IA (chat)");
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
  const activeAgents = agents.filter((a) => a.is_active);
  const intakeUrl = intakeAgent
    ? `${data.urls.lead_intake}&agent=${encodeURIComponent(intakeAgent)}`
    : data.urls.lead_intake;

  const apps: { id: AppId; name: string; text: string; status: string; ok: boolean; mark: string }[] = [
    {
      id: "ghl",
      name: "GoHighLevel",
      text: "Registra leads en el CRM, recibe citas agendadas y controla el bot desde tus workflows de GHL.",
      status: data.ghl_webhook_url || data.ghl_api_token_set ? "Conectado" : "Disponible",
      ok: Boolean(data.ghl_webhook_url || data.ghl_api_token_set),
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
              {activeAgents.length > 1 && (
                <label className={styles.field}>
                  <span className={styles.label}>Agente que atiende los leads de esta URL</span>
                  <select
                    className={styles.input}
                    value={intakeAgent}
                    onChange={(e) => setIntakeAgent(e.target.value)}
                  >
                    <option value="">El predeterminado para leads</option>
                    {activeAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <UrlRow
                label="① Registrar leads en el CRM"
                hint="ESTA es la URL para que un lead ENTRE al CRM. Workflow (trigger de nuevo lead) → “Webhook (Outbound)” (POST) a esta URL. Cada agente tiene su propia URL (elígelo arriba); también puedes mandar el campo agent con el id o el nombre del agente."
                url={intakeUrl}
                copied={copied === "generic"}
                onCopy={() => copy(intakeUrl, "generic")}
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
                hint='POST con JSON: {"action": "pause"} o {"action": "resume"}, más setter_id (o phone/contact_id). Opcional: "agent" con el id o el nombre del agente para pasarle la conversación.'
                url={data.urls.ghl_bot}
                copied={copied === "ghl_bot"}
                onCopy={() => copy(data.urls.ghl_bot, "ghl_bot")}
              />
              <UrlRow
                label="④ Enviar mensaje al lead por el bot"
                hint='POST con JSON: {"message": "tu texto"}, más setter_id (o phone/contact_id). Es un envío automático: no pausa la IA. Úsala para los mensajes de tus workflows de GHL; los que GHL envía por su cuenta llegan como si alguien escribiera desde el móvil y sí pausan.'
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
                <code className={styles.code}>setter_id</code> en un campo personalizado. El
                webhook incluye también <code className={styles.code}>agent_id</code> y{" "}
                <code className={styles.code}>agent_name</code>, y{" "}
                <code className={styles.code}>source</code> (<code className={styles.code}>ghl</code>{" "}
                o <code className={styles.code}>chat</code>).
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

              <h3 className={styles.subTitle}>Leads que entran por chat → GHL</h3>
              <p className={styles.muted}>
                Cuando alguien escribe directamente por WhatsApp o Instagram, creamos o actualizamos
                el contacto en GHL (buscándolo por teléfono o email) y guardamos el{" "}
                <code className={styles.code}>setter_id</code> en el campo que indiques. Necesitas
                un token de <strong>Private Integration</strong> de la subcuenta (Ajustes →
                Private Integrations, con permisos de contactos) y el Location ID.
              </p>
              <label className={styles.field}>
                <span className={styles.label}>Token de Private Integration</span>
                <input
                  className={styles.input}
                  type="password"
                  value={ghlToken}
                  onChange={(e) => setGhlToken(e.target.value)}
                  placeholder={data.ghl_api_token_set ? "•••••••• (guardado)" : "pit-…"}
                  autoComplete="off"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Location ID (subcuenta)</span>
                <input
                  className={styles.input}
                  value={ghlLocation}
                  onChange={(e) => setGhlLocation(e.target.value)}
                  placeholder="p.ej. ve9EPM428h8vShlRW1KT"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Campo personalizado para el setter_id (id o clave)</span>
                <input
                  className={styles.input}
                  value={ghlSetterField}
                  onChange={(e) => setGhlSetterField(e.target.value)}
                  placeholder="p.ej. contact.setter_id"
                />
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={ghlSync}
                  onChange={(e) => setGhlSync(e.target.checked)}
                />
                Crear/actualizar en GHL los leads que entran por chat
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Etiquetas que añade el bot (separadas por comas)</span>
                <input
                  className={styles.input}
                  value={ghlTags}
                  onChange={(e) => setGhlTags(e.target.value)}
                  placeholder="setter-ia"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Origen (source) de los contactos que crea el bot</span>
                <input
                  className={styles.input}
                  value={ghlSource}
                  onChange={(e) => setGhlSource(e.target.value)}
                  placeholder="Setter IA (chat)"
                />
              </label>
              <p className={styles.muted}>
                En contactos que ya existen en GHL solo se añaden estas etiquetas y el{" "}
                <code className={styles.code}>setter_id</code>: no se tocan su nombre, teléfono,
                email, origen ni el resto de etiquetas. El teléfono se busca en todas sus formas
                (p. ej. México +52 / +521) para no crear duplicados.
              </p>
              <div className={styles.btnRow}>
                <button
                  className={styles.saveBtn}
                  disabled={saving}
                  onClick={async () => {
                    await patch({
                      ...(ghlToken.trim() ? { ghl_api_token: ghlToken.trim() } : {}),
                      ghl_location_id: ghlLocation.trim(),
                      ghl_setter_field: ghlSetterField.trim(),
                      ghl_sync_chat_leads: ghlSync,
                      ghl_chat_tags: ghlTags.split(",").map((t) => t.trim()).filter(Boolean),
                      ghl_chat_source: ghlSource.trim(),
                    });
                    setGhlToken("");
                  }}
                >
                  {saving ? "Guardando…" : "Guardar conexión con GHL"}
                </button>
                {data.ghl_api_token_set && (
                  <button
                    className={styles.ghostBtn}
                    disabled={saving}
                    onClick={() => {
                      if (confirm("¿Quitar el token de GHL? Dejaremos de crear contactos desde el chat.")) {
                        void patch({ ghl_api_token: "" });
                      }
                    }}
                  >
                    Quitar token
                  </button>
                )}
              </div>
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
