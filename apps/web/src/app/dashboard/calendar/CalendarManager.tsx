"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import styles from "./calendar.module.css";

type AvailabilityRules = {
  tz?: string;
  days?: number[];
  start?: string;
  end?: string;
  slot_min?: number;
  buffer_min?: number;
  max_per_day?: number;
};

type Calendar = {
  id: string;
  provider: string;
  name: string | null;
  status: "pending" | "connected" | "error" | "disconnected";
  is_default: boolean;
  availability_rules: AvailabilityRules;
  last_error: string | null;
  connected_at: string | null;
};

type SetterConfig = {
  calendar_mode: "off" | "slots" | "link";
  calendar_link: string | null;
  call_duration_min: number;
  default_calendar_id: string | null;
};

type Appointment = {
  id: string;
  start_at: string | null;
  status: string;
  detected_by: string;
  meet_url: string | null;
  notes: string | null;
};

const STATUS_LABEL: Record<Calendar["status"], string> = {
  pending: "Pendiente",
  connected: "Conectado",
  error: "Error",
  disconnected: "Desconectado",
};

export default function CalendarManager() {
  const search = useSearchParams();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [cfg, setCfg] = useState<SetterConfig | null>(null);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  async function load() {
    const [cals, config, appointments] = await Promise.all([
      apiFetch<Calendar[]>("/api/calendar").catch(() => [] as Calendar[]),
      apiFetch<SetterConfig>("/api/setter/config"),
      apiFetch<Appointment[]>("/api/calendar/appointments").catch(() => [] as Appointment[]),
    ]);
    setCalendars(Array.isArray(cals) ? cals : []);
    setCfg(config);
    setLink(config.calendar_link ?? "");
    setAppts(Array.isArray(appointments) ? appointments : []);
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  async function connect(provider: "google" | "outlook") {
    setBusy(provider);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/calendar/connect", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al conectar");
      setBusy(null);
    }
  }

  async function disconnect(id: string) {
    if (!confirm("¿Desconectar este calendario?")) return;
    setBusy(id);
    try {
      await apiFetch(`/api/calendar/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function saveRules(cal: Calendar, patch: Partial<AvailabilityRules>) {
    setBusy(cal.id);
    try {
      await apiFetch(`/api/calendar/${cal.id}`, {
        method: "PUT",
        body: JSON.stringify({ availability_rules: { ...cal.availability_rules, ...patch } }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function patchCfg(body: Partial<SetterConfig>) {
    setBusy("cfg");
    try {
      const updated = await apiFetch<SetterConfig>("/api/setter/config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setCfg(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className={styles.muted}>Cargando…</p>;

  const connected = calendars.filter((c) => c.status !== "disconnected");

  return (
    <div className={styles.wrap}>
      {search.get("connected") === "1" && (
        <div className={styles.muted}>Calendario conectado correctamente.</div>
      )}
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Conectar calendario</h2>
        <p className={styles.muted}>
          Conecta tu calendario para que el bot consulte tu disponibilidad y registre las citas.
        </p>
        <div className={styles.providerRow}>
          <button className={styles.ghostBtn} disabled={busy !== null} onClick={() => connect("google")}>
            {busy === "google" ? "Abriendo…" : "Conectar Google Calendar"}
          </button>
          <button className={styles.ghostBtn} disabled={busy !== null} onClick={() => connect("outlook")}>
            {busy === "outlook" ? "Abriendo…" : "Conectar Outlook"}
          </button>
        </div>

        {connected.length > 0 && (
          <ul className={styles.list}>
            {connected.map((c) => (
              <li key={c.id} className={styles.item}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{c.name ?? c.provider}</span>
                  <span className={styles.hint}>{c.provider}</span>
                  {c.last_error && <span className={styles.hint}>{c.last_error}</span>}
                  {c.status === "connected" && (
                    <div className={styles.row} style={{ marginTop: 8 }}>
                      <label className={styles.field} style={{ margin: 0 }}>
                        <span className={styles.label}>Desde</span>
                        <input
                          className={styles.input}
                          type="time"
                          defaultValue={c.availability_rules?.start ?? "09:00"}
                          onBlur={(e) => saveRules(c, { start: e.target.value })}
                        />
                      </label>
                      <label className={styles.field} style={{ margin: 0 }}>
                        <span className={styles.label}>Hasta</span>
                        <input
                          className={styles.input}
                          type="time"
                          defaultValue={c.availability_rules?.end ?? "18:00"}
                          onBlur={(e) => saveRules(c, { end: e.target.value })}
                        />
                      </label>
                      <label className={styles.field} style={{ margin: 0 }}>
                        <span className={styles.label}>Duración (min)</span>
                        <input
                          className={styles.input}
                          type="number"
                          min={10}
                          max={240}
                          defaultValue={c.availability_rules?.slot_min ?? 30}
                          onBlur={(e) => saveRules(c, { slot_min: Number(e.target.value) })}
                          style={{ width: 90 }}
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={`${styles.status} ${styles[`status_${c.status}`]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                  <button className={styles.ghostBtn} disabled={busy !== null} onClick={() => disconnect(c.id)}>
                    Desconectar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Cómo agenda el bot</h2>
        <label className={styles.field}>
          <span className={styles.label}>Modo de agenda</span>
          <select
            className={styles.select}
            value={cfg?.calendar_mode ?? "off"}
            onChange={(e) => patchCfg({ calendar_mode: e.target.value as SetterConfig["calendar_mode"] })}
            disabled={busy !== null}
          >
            <option value="off">Desactivado (el bot no agenda)</option>
            <option value="slots">Ofrecer huecos reales de mi calendario</option>
            <option value="link">Compartir mi enlace de agenda</option>
          </select>
        </label>

        {cfg?.calendar_mode === "link" && (
          <label className={styles.field}>
            <span className={styles.label}>Enlace de agenda (Calendly, Cal.com, etc.)</span>
            <div className={styles.row}>
              <input
                className={styles.input}
                value={link}
                placeholder="https://cal.com/tu-usuario/30min"
                onChange={(e) => setLink(e.target.value)}
                style={{ flex: 1, minWidth: 280 }}
              />
              <button className={styles.saveBtn} disabled={busy !== null} onClick={() => patchCfg({ calendar_link: link })}>
                Guardar
              </button>
            </div>
          </label>
        )}

        {cfg?.calendar_mode === "slots" && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>Calendario para comprobar disponibilidad</span>
              <select
                className={styles.select}
                value={cfg?.default_calendar_id ?? ""}
                onChange={(e) => patchCfg({ default_calendar_id: e.target.value || undefined })}
                disabled={busy !== null}
              >
                <option value="">Selecciona un calendario…</option>
                {connected
                  .filter((c) => c.status === "connected")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.provider}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Duración de la llamada (min)</span>
              <input
                className={styles.input}
                type="number"
                min={5}
                max={240}
                defaultValue={cfg?.call_duration_min ?? 30}
                onBlur={(e) => patchCfg({ call_duration_min: Number(e.target.value) })}
                style={{ width: 120 }}
              />
            </label>
          </>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Llamadas agendadas</h2>
        <p className={styles.muted}>
          Citas detectadas por el bot en las conversaciones o sincronizadas desde tu calendario.
        </p>
        {appts.length === 0 ? (
          <p className={styles.hint}>Aún no hay llamadas agendadas.</p>
        ) : (
          appts.map((a) => (
            <div key={a.id} className={styles.apptRow}>
              <span>{a.start_at ? new Date(a.start_at).toLocaleString("es-ES") : "Sin fecha concreta"}</span>
              <span className={styles.badge}>
                {a.detected_by === "bot" ? "detectada por el bot" : a.detected_by} · {a.status}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
