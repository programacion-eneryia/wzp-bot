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
  byChannel: Record<string, number>;
  byAgent: Record<string, { name: string; count: number }>;
  supportConversations: number;
  crm: { total: number; byStatus: Record<string, number>; bySource: Record<string, number> };
  stages: { key: string; name: string; color: string }[];
  agents: { id: string; name: string; kind: string; uses_stages: boolean }[];
  conversations: { total: number; byStage: Record<string, number> };
  appointments: {
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    upcoming: number;
  };
  tags: { id: string; name: string; color: string; count: number }[];
  messagesTotal: number;
  rates: {
    qualifiedPct: number;
    calendarSentPct: number;
    callScheduledPct: number;
    wonPct: number;
    lostPct: number;
  };
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

const PRESETS: { id: string; label: string; days: number | null }[] = [
  { id: "all", label: "Todo", days: null },
  { id: "7", label: "7 días", days: 7 },
  { id: "30", label: "30 días", days: 30 },
  { id: "90", label: "90 días", days: 90 },
];

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

export default function Stats() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState("");
  const [preset, setPreset] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams();
    if (agentId) params.set("agent_id", agentId);
    const days = PRESETS.find((p) => p.id === preset)?.days ?? null;
    if (days) {
      const from = new Date();
      from.setDate(from.getDate() - days);
      from.setHours(0, 0, 0, 0);
      params.set("from", from.toISOString());
    }
    const qs = params.toString();
    setLoading(true);
    apiFetch<Overview>(`/api/stats/overview${qs ? `?${qs}` : ""}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"))
      .finally(() => setLoading(false));
  }, [agentId, preset]);

  if (loading && !data) return <p className={styles.muted}>Cargando…</p>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!data) return null;

  const statusEntries = data.stages
    .filter((s) => (data.leads.byStatus[s.key] ?? 0) > 0)
    .map((s) => ({ key: s.key, label: s.name, color: s.color, count: data.leads.byStatus[s.key] }));
  const maxStatus = Math.max(1, ...statusEntries.map((e) => e.count));

  const channelEntries = Object.entries(data.byChannel ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: CHANNEL_LABEL[k] ?? k, count: v }));
  const maxChannel = Math.max(1, ...channelEntries.map((e) => e.count));
  const agentEntries = Object.values(data.byAgent ?? {}).sort((a, b) => b.count - a.count);
  const maxAgent = Math.max(1, ...agentEntries.map((e) => e.count));
  const by = data.leads.byStatus;
  const calendarSent = (by.calendar_sent ?? 0) + (by.call_scheduled ?? 0) + (by.won ?? 0);
  const callScheduled = (by.call_scheduled ?? 0) + (by.won ?? 0);
  const qualified = (by.qualified ?? 0) + calendarSent;

  const sourceEntries = Object.entries(data.leads.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: SOURCE_LABEL[k] ?? k, count: v }));
  const maxSource = Math.max(1, ...sourceEntries.map((e) => e.count));

  const maxTag = Math.max(1, ...data.tags.map((t) => t.count));
  const maxDay = Math.max(1, ...data.leads.last30.map((d) => d.count));

  return (
    <div className={styles.wrap}>
      <div className={styles.filters}>
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`${styles.preset} ${preset === p.id ? styles.presetActive : ""}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {data.agents.length > 1 && (
          <select
            className={styles.select}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Todos los agentes</option>
            {data.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {loading && <span className={styles.muted}>Actualizando…</span>}
      </div>

      <div className={styles.kpis}>
        <Kpi
          label="Leads atendidos"
          value={data.leads.total}
          sub="Conversaciones con al menos una respuesta del agente"
          accent
        />
        <Kpi label="Cualificados" value={`${data.rates.qualifiedPct}%`} sub={`${qualified} leads`} />
        <Kpi label="Calendario enviado" value={calendarSent} sub={`${data.rates.calendarSentPct}% del total`} />
        <Kpi label="Llamadas agendadas" value={callScheduled} sub={`${data.rates.callScheduledPct}% del total`} />
        <Kpi label="Ganados" value={by.won ?? 0} sub={`${data.rates.wonPct}% del total`} />
        <Kpi label="Perdidos / no cualifican" value={(by.lost ?? 0) + (by.not_qualified ?? 0)} sub={`${data.rates.lostPct}% del total`} />
        <Kpi label="Citas próximas" value={data.appointments.upcoming} sub={`${data.appointments.total} en total`} />
        <Kpi label="Soporte" value={data.supportConversations} sub="Chats atendidos sin pipeline" />
        <Kpi label="Contactos en CRM" value={data.crm.total} sub={`${data.messagesTotal} mensajes en total`} />
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Embudo por etapa</h2>
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
                  color={e.color || "var(--accent, #ffe600)"}
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Leads por canal</h2>
          {channelEntries.length === 0 ? (
            <p className={styles.muted}>Sin datos todavía.</p>
          ) : (
            <div className={styles.bars}>
              {channelEntries.map((e) => (
                <BarRow
                  key={e.label}
                  label={e.label}
                  value={e.count}
                  pct={(e.count / maxChannel) * 100}
                  color="#22c55e"
                />
              ))}
            </div>
          )}
        </section>

        {agentEntries.length > 1 && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Leads por agente</h2>
            <div className={styles.bars}>
              {agentEntries.map((e) => (
                <BarRow
                  key={e.name}
                  label={e.name}
                  value={e.count}
                  pct={(e.count / maxAgent) * 100}
                  color="#a855f7"
                />
              ))}
            </div>
          </section>
        )}

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
