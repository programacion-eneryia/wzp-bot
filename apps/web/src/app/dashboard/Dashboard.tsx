"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import stats from "./stats/stats.module.css";
import styles from "./home.module.css";

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

type WidgetKey =
  | "kpis"
  | "funnel"
  | "channels"
  | "agents"
  | "tags"
  | "sources"
  | "timeline"
  | "appointments"
  | "shortcuts";

const WIDGETS: { key: WidgetKey; label: string; wide?: boolean }[] = [
  { key: "kpis", label: "Indicadores clave", wide: true },
  { key: "funnel", label: "Embudo por etapa" },
  { key: "channels", label: "Leads por canal" },
  { key: "agents", label: "Leads por agente" },
  { key: "tags", label: "Etiquetas" },
  { key: "sources", label: "Leads por fuente" },
  { key: "appointments", label: "Citas" },
  { key: "timeline", label: "Leads en los últimos 30 días", wide: true },
  { key: "shortcuts", label: "Accesos rápidos", wide: true },
];

const DEFAULT_WIDGETS: WidgetKey[] = [
  "kpis",
  "funnel",
  "channels",
  "tags",
  "agents",
  "timeline",
  "shortcuts",
];

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
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
  ctwa: "Anuncio click-to-WhatsApp",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  otro: "Otro",
};

const APPT_LABEL: Record<string, string> = {
  scheduled: "Agendadas",
  completed: "Completadas",
  cancelled: "Canceladas",
};

const PRESETS: { id: string; label: string; days: number | null }[] = [
  { id: "all", label: "Todo", days: null },
  { id: "7", label: "7 días", days: 7 },
  { id: "30", label: "30 días", days: 30 },
  { id: "90", label: "90 días", days: 90 },
];

export default function Dashboard({ firstName }: { firstName: string | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState("");
  const [preset, setPreset] = useState("30");
  const [widgets, setWidgets] = useState<WidgetKey[]>(DEFAULT_WIDGETS);
  const [editing, setEditing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Preferencias del usuario (widgets visibles y orden).
  useEffect(() => {
    apiFetch<{ widgets: string[] } | null>("/api/me/dashboard")
      .then((p) => {
        if (p?.widgets?.length) {
          const valid = p.widgets.filter((w): w is WidgetKey =>
            WIDGETS.some((d) => d.key === w),
          );
          if (valid.length) setWidgets(valid);
        }
      })
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));
  }, []);

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

  function savePrefs(next: WidgetKey[]) {
    setWidgets(next);
    void apiFetch("/api/me/dashboard", {
      method: "PUT",
      body: JSON.stringify({ widgets: next }),
    }).catch(() => {});
  }

  function toggle(key: WidgetKey) {
    savePrefs(widgets.includes(key) ? widgets.filter((w) => w !== key) : [...widgets, key]);
  }

  function move(key: WidgetKey, dir: -1 | 1) {
    const i = widgets.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    savePrefs(next);
  }

  const derived = useMemo(() => {
    if (!data) return null;
    const by = data.leads.byStatus;
    const calendarSent = (by.calendar_sent ?? 0) + (by.call_scheduled ?? 0) + (by.won ?? 0);
    const callScheduled = (by.call_scheduled ?? 0) + (by.won ?? 0);
    const qualified = (by.qualified ?? 0) + calendarSent;
    const stageEntries = data.stages
      .filter((s) => (by[s.key] ?? 0) > 0)
      .map((s) => ({ key: s.key, label: s.name, color: s.color, count: by[s.key] }));
    const channelEntries = Object.entries(data.byChannel ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ label: CHANNEL_LABEL[k] ?? k, count: v }));
    const agentEntries = Object.values(data.byAgent ?? {}).sort((a, b) => b.count - a.count);
    const sourceEntries = Object.entries(data.leads.bySource ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ label: SOURCE_LABEL[k] ?? k, count: v }));
    return {
      by,
      calendarSent,
      callScheduled,
      qualified,
      stageEntries,
      channelEntries,
      agentEntries,
      sourceEntries,
    };
  }, [data]);

  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <span className={styles.eyebrow}>Dashboard</span>
          <h1 className={styles.title}>
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <div className={styles.controls}>
          <div className={stats.presets}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`${stats.preset} ${preset === p.id ? stats.presetActive : ""}`}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {data && data.agents.length > 1 && (
            <select
              className={stats.select}
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
          <button
            className={`${styles.editBtn} ${editing ? styles.editBtnOn : ""}`}
            onClick={() => setEditing((v) => !v)}
            type="button"
          >
            {editing ? "Listo" : "Personalizar"}
          </button>
        </div>
      </div>

      {editing && (
        <div className={styles.editor}>
          <p className={styles.editorHint}>
            Elige qué bloques ves y en qué orden. Se guarda para tu usuario.
          </p>
          <ul className={styles.editorList}>
            {[...widgets, ...WIDGETS.map((w) => w.key).filter((k) => !widgets.includes(k))].map(
              (key) => {
                const def = WIDGETS.find((w) => w.key === key)!;
                const on = widgets.includes(key);
                const idx = widgets.indexOf(key);
                return (
                  <li key={key} className={`${styles.editorItem} ${on ? "" : styles.editorItemOff}`}>
                    <label className={styles.editorCheck}>
                      <input type="checkbox" checked={on} onChange={() => toggle(key)} />
                      {def.label}
                    </label>
                    {on && (
                      <span className={styles.editorMove}>
                        <button onClick={() => move(key, -1)} disabled={idx === 0} type="button">
                          ↑
                        </button>
                        <button
                          onClick={() => move(key, 1)}
                          disabled={idx === widgets.length - 1}
                          type="button"
                        >
                          ↓
                        </button>
                      </span>
                    )}
                  </li>
                );
              },
            )}
          </ul>
          <button
            className={styles.resetBtn}
            onClick={() => savePrefs(DEFAULT_WIDGETS)}
            type="button"
          >
            Restablecer
          </button>
        </div>
      )}

      {error && <div className={stats.error}>{error}</div>}
      {!data && loading && <p className={stats.muted}>Cargando…</p>}

      {data && derived && prefsLoaded && (
        <div className={styles.grid}>
          {widgets.map((key) => {
            const def = WIDGETS.find((w) => w.key === key)!;
            const cls = `${stats.card} ${def.wide ? styles.wide : ""}`;
            switch (key) {
              case "kpis":
                return (
                  <div key={key} className={`${stats.kpis} ${styles.wide}`}>
                    <Kpi
                      label="Leads atendidos"
                      value={data.leads.total}
                      sub="Con al menos una respuesta del agente"
                      accent
                    />
                    <Kpi
                      label="Cualificados"
                      value={`${data.rates.qualifiedPct}%`}
                      sub={`${derived.qualified} leads`}
                    />
                    <Kpi
                      label="Calendario enviado"
                      value={derived.calendarSent}
                      sub={`${data.rates.calendarSentPct}% del total`}
                    />
                    <Kpi
                      label="Llamadas agendadas"
                      value={derived.callScheduled}
                      sub={`${data.rates.callScheduledPct}% del total`}
                    />
                    <Kpi
                      label="Ganados"
                      value={derived.by.won ?? 0}
                      sub={`${data.rates.wonPct}% del total`}
                    />
                    <Kpi
                      label="Perdidos / no cualifican"
                      value={(derived.by.lost ?? 0) + (derived.by.not_qualified ?? 0)}
                      sub={`${data.rates.lostPct}% del total`}
                    />
                    <Kpi
                      label="Citas próximas"
                      value={data.appointments.upcoming}
                      sub={`${data.appointments.total} en total`}
                    />
                    <Kpi label="Soporte" value={data.supportConversations} sub="Chats sin pipeline" />
                  </div>
                );
              case "funnel":
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    <Bars
                      entries={derived.stageEntries.map((e) => ({
                        label: e.label,
                        count: e.count,
                        color: e.color,
                      }))}
                      empty="Sin leads en el periodo."
                    />
                  </section>
                );
              case "channels":
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    <Bars entries={derived.channelEntries} color="#22c55e" empty="Sin datos." />
                  </section>
                );
              case "agents":
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    <Bars
                      entries={derived.agentEntries.map((a) => ({ label: a.name, count: a.count }))}
                      color="#a855f7"
                      empty="Sin datos."
                    />
                  </section>
                );
              case "sources":
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    <Bars entries={derived.sourceEntries} color="#5aa0ff" empty="Sin datos." />
                  </section>
                );
              case "tags":
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    <Bars
                      entries={data.tags.map((t) => ({
                        label: t.name,
                        count: t.count,
                        color: t.color || "#a855f7",
                      }))}
                      empty="Aún no hay etiquetas."
                    />
                  </section>
                );
              case "appointments":
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    {data.appointments.total === 0 ? (
                      <p className={stats.muted}>Sin citas todavía.</p>
                    ) : (
                      <div className={stats.chips}>
                        {Object.entries(data.appointments.byStatus).map(([k, v]) => (
                          <div key={k} className={stats.chip}>
                            <span className={stats.chipValue}>{v}</span>
                            <span className={stats.chipLabel}>{APPT_LABEL[k] ?? k}</span>
                          </div>
                        ))}
                        <div className={stats.chip}>
                          <span className={stats.chipValue}>{data.appointments.upcoming}</span>
                          <span className={stats.chipLabel}>Próximas</span>
                        </div>
                      </div>
                    )}
                  </section>
                );
              case "timeline": {
                const maxDay = Math.max(1, ...data.leads.last30.map((d) => d.count));
                return (
                  <section key={key} className={cls}>
                    <h2 className={stats.cardTitle}>{def.label}</h2>
                    <div className={stats.spark}>
                      {data.leads.last30.map((d) => (
                        <div
                          key={d.date}
                          className={stats.sparkBar}
                          style={{ height: `${(d.count / maxDay) * 100}%` }}
                          title={`${d.date}: ${d.count}`}
                        />
                      ))}
                    </div>
                    <div className={stats.sparkAxis}>
                      <span>{data.leads.last30[0]?.date.slice(5)}</span>
                      <span>{data.leads.last30[data.leads.last30.length - 1]?.date.slice(5)}</span>
                    </div>
                  </section>
                );
              }
              case "shortcuts":
                return (
                  <section key={key} className={`${styles.shortcuts} ${styles.wide}`}>
                    <Shortcut href="/dashboard/inbox" title="Chats" text="Conversaciones en vivo con tus leads." />
                    <Shortcut href="/dashboard/crm" title="CRM" text="Todos tus contactos y su etapa." />
                    <Shortcut href="/dashboard/agents" title="Agentes" text="Personalidad, reglas y canales." />
                    <Shortcut href="/dashboard/workflows" title="Workflows" text="Seguimientos automáticos." />
                    <Shortcut href="/dashboard/stats" title="Estadísticas" text="Métricas completas del embudo." />
                    <Shortcut href="/dashboard/setter" title="Base de Conocimiento" text="Lo que saben tus agentes." />
                  </section>
                );
              default:
                return null;
            }
          })}
        </div>
      )}
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
    <div className={`${stats.kpi} ${accent ? stats.kpiAccent : ""}`}>
      <span className={stats.kpiValue}>{value}</span>
      <span className={stats.kpiLabel}>{label}</span>
      {sub && <span className={stats.kpiSub}>{sub}</span>}
    </div>
  );
}

function Bars({
  entries,
  color,
  empty,
}: {
  entries: { label: string; count: number; color?: string }[];
  color?: string;
  empty: string;
}) {
  if (entries.length === 0) return <p className={stats.muted}>{empty}</p>;
  const max = Math.max(1, ...entries.map((e) => e.count));
  return (
    <div className={stats.bars}>
      {entries.map((e) => (
        <div key={e.label} className={stats.barRow}>
          <span className={stats.barLabel}>{e.label}</span>
          <div className={stats.barTrack}>
            <div
              className={stats.barFill}
              style={{
                width: `${Math.max(2, (e.count / max) * 100)}%`,
                background: e.color ?? color ?? "var(--accent)",
              }}
            />
          </div>
          <span className={stats.barValue}>{e.count}</span>
        </div>
      ))}
    </div>
  );
}

function Shortcut({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className={styles.shortcut}>
      <span className={styles.shortcutTitle}>{title}</span>
      <span className={styles.shortcutText}>{text}</span>
    </Link>
  );
}
