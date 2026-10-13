"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAgents } from "@/lib/agents";
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

type Appointment = {
  id: string;
  start_at: string | null;
  status: string;
  detected_by: string;
  meet_url: string | null;
  notes: string | null;
  contact_name: string | null;
  contact_handle: string | null;
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
  const { agents } = useAgents();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [cals, appointments] = await Promise.all([
      apiFetch<Calendar[]>("/api/calendar").catch(() => [] as Calendar[]),
      apiFetch<Appointment[]>("/api/calendar/appointments").catch(() => [] as Appointment[]),
    ]);
    setCalendars(Array.isArray(cals) ? cals : []);
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
        <h2 className={styles.cardTitle}>Cómo agenda cada agente</h2>
        <p className={styles.muted}>
          La forma de agendar se configura en cada agente (pestaña “Agenda”): ofrecer huecos de
          uno de estos calendarios, compartir un enlace o no agendar.
        </p>
        {agents.length > 0 && (
          <ul className={styles.list}>
            {agents.map((a) => {
              const cal = calendars.find((c) => c.id === a.default_calendar_id);
              const how =
                a.kind === "support" || a.calendar_mode === "off"
                  ? "No agenda"
                  : a.calendar_mode === "link"
                    ? a.calendar_link
                      ? `Comparte su enlace (${a.calendar_link})`
                      : "Enlace sin configurar"
                    : cal
                      ? `Ofrece huecos de ${cal.name ?? cal.provider}`
                      : "Huecos: falta elegir calendario";
              return (
                <li key={a.id} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{a.name}</span>
                    <span className={styles.hint}>{how}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.row}>
          <Link href="/dashboard/agents" className={styles.ghostBtn}>
            Configurar en Agentes →
          </Link>
        </div>
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
              <span>
                {a.start_at ? new Date(a.start_at).toLocaleString("es-ES") : "Sin fecha concreta"}
                {(a.contact_name || a.contact_handle) && (
                  <span className={styles.muted}>
                    {" · "}
                    {a.contact_name ?? "Lead"}
                    {a.contact_handle ? ` (${a.contact_handle})` : ""}
                  </span>
                )}
              </span>
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
