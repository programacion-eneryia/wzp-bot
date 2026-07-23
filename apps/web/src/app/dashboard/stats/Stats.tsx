"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./stats.module.css";

type Overview = {
  leads: {
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    last30: { date: string; count: number }[];
  };
  conversations: { total: number; byStage: Record<string, number> };
  appointments: {
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    upcoming: number;
  };
  tags: { id: string; name: string; color: string; count: number }[];
  messagesTotal: number;
  rates: { qualifiedPct: number; callScheduledPct: number; wonPct: number; lostPct: number };
};

const STATUS_LABEL: Record<string, string> = {
  new: "Nuevo",
  qualifying: "Cualificando",
  qualified: "Cualificado",
  not_qualified: "No cualifica",
  call_scheduled: "Llamada agendada",
  won: "Ganado",
  lost: "Perdido",
};

const SOURCE_LABEL: Record<string, string> = {
  ghl: "GoHighLevel",
  manychat: "ManyChat",
  meta_lead: "Meta Lead Ads",
  webhook: "Webhook",
  manual: "Manual",
  csv: "CSV",
  inbound: "Mensaje entrante",
  organic: "Orgánico",
  otro: "Otro",
};

const APPT_LABEL: Record<string, string> = {
  scheduled: "Agendadas",
  completed: "Completadas",
  cancelled: "Canceladas",
};

const STATUS_ORDER = [
  "new",
  "qualifying",
  "qualified",
  "call_scheduled",
  "won",
  "not_qualified",
  "lost",
];

export default function Stats() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Overview>("/api/stats/overview")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className={styles.muted}>Cargando…</p>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!data) return null;

  const statusEntries = STATUS_ORDER.filter((s) => data.leads.byStatus[s] != null).map((s) => ({
    key: s,
    label: STATUS_LABEL[s] ?? s,
    count: data.leads.byStatus[s],
  }));
  const maxStatus = Math.max(1, ...statusEntries.map((e) => e.count));

  const sourceEntries = Object.entries(data.leads.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: SOURCE_LABEL[k] ?? k, count: v }));
  const maxSource = Math.max(1, ...sourceEntries.map((e) => e.count));

  const maxTag = Math.max(1, ...data.tags.map((t) => t.count));
  const maxDay = Math.max(1, ...data.leads.last30.map((d) => d.count));

  return (
    <div className={styles.wrap}>
      <div className={styles.kpis}>
        <Kpi label="Total leads" value={data.leads.total} accent />
        <Kpi label="Cualificados" value={`${data.rates.qualifiedPct}%`} sub={`${(data.leads.byStatus.qualified ?? 0) + (data.leads.byStatus.call_scheduled ?? 0) + (data.leads.byStatus.won ?? 0)} leads`} />
        <Kpi label="Llamadas agendadas" value={data.leads.byStatus.call_scheduled ?? 0} sub={`${data.rates.callScheduledPct}% del total`} />
        <Kpi label="Ganados" value={data.leads.byStatus.won ?? 0} sub={`${data.rates.wonPct}% del total`} />
        <Kpi label="Citas próximas" value={data.appointments.upcoming} sub={`${data.appointments.total} en total`} />
        <Kpi label="Conversaciones" value={data.conversations.total} sub={`${data.messagesTotal} mensajes`} />
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Leads por estado (embudo)</h2>
          {statusEntries.length === 0 ? (
            <p className={styles.muted}>Sin datos todavía.</p>
          ) : (
            <div className={styles.bars}>
              {statusEntries.map((e) => (
                <BarRow
                  key={e.key}
                  label={e.label}
                  value={e.count}
                  pct={(e.count / maxStatus) * 100}
                  color="var(--accent, #ffe600)"
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Leads por fuente</h2>
          {sourceEntries.length === 0 ? (
            <p className={styles.muted}>Sin datos todavía.</p>
          ) : (
            <div className={styles.bars}>
              {sourceEntries.map((e) => (
                <BarRow
                  key={e.label}
                  label={e.label}
                  value={e.count}
                  pct={(e.count / maxSource) * 100}
                  color="#5aa0ff"
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Etiquetas</h2>
          {data.tags.length === 0 ? (
            <p className={styles.muted}>Aún no hay etiquetas.</p>
          ) : (
            <div className={styles.bars}>
              {data.tags.map((t) => (
                <BarRow
                  key={t.id}
                  label={t.name}
                  value={t.count}
                  pct={(t.count / maxTag) * 100}
                  color={t.color || "#a855f7"}
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Citas</h2>
          {data.appointments.total === 0 ? (
            <p className={styles.muted}>Sin citas todavía.</p>
          ) : (
            <div className={styles.chips}>
              {Object.entries(data.appointments.byStatus).map(([k, v]) => (
                <div key={k} className={styles.chip}>
                  <span className={styles.chipValue}>{v}</span>
                  <span className={styles.chipLabel}>{APPT_LABEL[k] ?? k}</span>
                </div>
              ))}
              <div className={styles.chip}>
                <span className={styles.chipValue}>{data.appointments.upcoming}</span>
                <span className={styles.chipLabel}>Próximas</span>
              </div>
            </div>
          )}
        </section>

        <section className={`${styles.card} ${styles.cardWide}`}>
          <h2 className={styles.cardTitle}>Leads en los últimos 30 días</h2>
          <div className={styles.spark}>
            {data.leads.last30.map((d) => (
              <div
                key={d.date}
                className={styles.sparkBar}
                style={{ height: `${(d.count / maxDay) * 100}%` }}
                title={`${d.date}: ${d.count}`}
              />
            ))}
          </div>
          <div className={styles.sparkAxis}>
            <span>{data.leads.last30[0]?.date.slice(5)}</span>
            <span>{data.leads.last30[data.leads.last30.length - 1]?.date.slice(5)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`${styles.kpi} ${accent ? styles.kpiAccent : ""}`}>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: number;
  pct: number;
  color: string;
}) {
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{ width: `${Math.max(2, pct)}%`, background: color }}
        />
      </div>
      <span className={styles.barValue}>{value}</span>
    </div>
  );
}
