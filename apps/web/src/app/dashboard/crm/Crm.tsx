"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUpload } from "@/lib/api";
import styles from "./crm.module.css";

type TagRef = { tag_id: string; name: string; color: string };
type TagDef = { id: string; name: string; color: string };

type LeadRow = {
  id: string;
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  provider: string | null;
  source: string | null;
  source_detail: string | null;
  campaign: string | null;
  status: string;
  created_at: string;
  tags?: TagRef[];
};

type LeadDetail = LeadRow & {
  external_id: string | null;
  consent_optin: boolean;
  first_message: string | null;
  fields: Record<string, unknown> | null;
  raw: Record<string, unknown> | null;
  notes: string | null;
  updated_at: string;
};

type ConversationSummary = {
  id: string;
  provider: string;
  contact_name: string | null;
  contact_handle: string | null;
  stage: string;
  mode: string;
  ai_enabled: boolean;
  last_message_at: string | null;
} | null;

type Stats = {
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
};

const STATUSES: { value: string; label: string }[] = [
  { value: "new", label: "Nuevo" },
  { value: "qualifying", label: "Cualificando" },
  { value: "qualified", label: "Cualificado" },
  { value: "not_qualified", label: "No cualifica" },
  { value: "call_scheduled", label: "Llamada agendada" },
  { value: "won", label: "Ganado" },
  { value: "lost", label: "Perdido" },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
);

const SOURCE_LABEL: Record<string, string> = {
  ghl: "GoHighLevel",
  manychat: "ManyChat",
  meta_lead: "Meta Lead Ads",
  ig_comment: "Comentario IG",
  ig_dm: "DM Instagram",
  ctwa: "Click-to-WhatsApp",
  webhook: "Webhook",
  manual: "Manual",
  csv: "CSV",
  inbound: "Mensaje entrante",
  organic: "Orgánico",
};

function sourceLabel(s: string | null): string {
  if (!s) return "—";
  return SOURCE_LABEL[s] ?? s;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Crm() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [tagId, setTagId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tagDefs, setTagDefs] = useState<TagDef[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      if (tagId) params.set("tag_id", tagId);
      if (search.trim()) params.set("search", search.trim());
      const qs = params.toString();
      const [rows, st] = await Promise.all([
        apiFetch<LeadRow[]>(`/api/crm/leads${qs ? `?${qs}` : ""}`),
        apiFetch<Stats>("/api/crm/leads/stats").catch(() => null),
      ]);
      setLeads(Array.isArray(rows) ? rows : []);
      if (st) setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [status, source, tagId, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    apiFetch<TagDef[]>("/api/tags")
      .then((d) => setTagDefs(Array.isArray(d) ? d : []))
      .catch(() => setTagDefs([]));
  }, []);

  async function onCsvSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportInfo("Importando…");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiUpload<{ imported: number; skipped: number; total: number }>(
        "/api/crm/leads/import",
        form,
      );
      setImportInfo(`Importados ${res.imported} de ${res.total} (omitidos ${res.skipped}).`);
      await load();
    } catch (err) {
      setImportInfo(null);
      setError(err instanceof Error ? err.message : "No se pudo importar el CSV");
    }
  }

  const sources = stats ? Object.keys(stats.bySource) : [];

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      {stats && (
        <div className={styles.statsRow}>
          <StatCard label="Total leads" value={stats.total} accent onClick={() => setStatus("")} />
          <StatCard
            label="Nuevos"
            value={stats.byStatus.new ?? 0}
            onClick={() => setStatus("new")}
          />
          <StatCard
            label="Cualificados"
            value={stats.byStatus.qualified ?? 0}
            onClick={() => setStatus("qualified")}
          />
          <StatCard
            label="Llamadas"
            value={stats.byStatus.call_scheduled ?? 0}
            onClick={() => setStatus("call_scheduled")}
          />
          <StatCard
            label="Ganados"
            value={stats.byStatus.won ?? 0}
            onClick={() => setStatus("won")}
          />
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="Buscar por nombre, teléfono o email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Todas las fuentes</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
        <select className={styles.select} value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">Todas las etiquetas</option>
          {tagDefs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className={styles.ghostBtn} onClick={load}>
          Actualizar
        </button>
        <div className={styles.toolbarSpacer} />
        <button className={styles.ghostBtn} onClick={() => fileRef.current?.click()}>
          Importar CSV
        </button>
        <button className={styles.primaryBtn} onClick={() => setShowAdd(true)}>
          + Añadir lead
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={onCsvSelected}
        />
      </div>

      {importInfo && <div className={styles.info}>{importInfo}</div>}

      {loading ? (
        <p className={styles.muted}>Cargando…</p>
      ) : leads.length === 0 ? (
        <div className={styles.empty}>
          <p>Aún no hay leads.</p>
          <p className={styles.muted}>
            En cuanto entre uno por GoHighLevel, ManyChat o tu formulario, aparecerá aquí
            automáticamente.
          </p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Contacto</th>
                <th>Fuente</th>
                <th>Etiquetas</th>
                <th>Estado</th>
                <th>Fecha de creación</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} onClick={() => setSelected(l.id)} className={styles.row}>
                  <td className={styles.nameCell}>{l.name || "Lead"}</td>
                  <td className={styles.muted}>{l.phone || l.email || "—"}</td>
                  <td>
                    <span className={styles.sourceTag}>{sourceLabel(l.source)}</span>
                  </td>
                  <td>
                    {l.tags && l.tags.length > 0 ? (
                      <span className={styles.tagChips}>
                        {l.tags.map((t) => (
                          <span
                            key={t.tag_id}
                            className={styles.tagChip}
                            style={{ borderColor: t.color, color: t.color }}
                          >
                            {t.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.statusTag} ${styles[`st_${l.status}`] ?? ""}`}>
                      {STATUS_LABEL[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className={styles.muted}>{fmtDate(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <LeadDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            void load();
          }}
          onDeleted={() => {
            setSelected(null);
            void load();
          }}
        />
      )}

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AddLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    source: "manual",
    campaign: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.name && !form.phone && !form.email) {
      setError("Indica al menos nombre, teléfono o email.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/crm/leads", {
        method: "POST",
        body: JSON.stringify({
          name: form.name || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          source: form.source || "manual",
          campaign: form.campaign || undefined,
        }),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHead}>
          <h2 className={styles.drawerTitle}>Añadir lead</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.modalBody}>
          <label className={styles.modalLabel}>Nombre</label>
          <input className={styles.input} value={form.name} onChange={(e) => set("name", e.target.value)} />
          <label className={styles.modalLabel}>Teléfono</label>
          <input
            className={styles.input}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+34600000000"
          />
          <label className={styles.modalLabel}>Email</label>
          <input className={styles.input} value={form.email} onChange={(e) => set("email", e.target.value)} />
          <label className={styles.modalLabel}>Fuente</label>
          <input className={styles.input} value={form.source} onChange={(e) => set("source", e.target.value)} />
          <label className={styles.modalLabel}>Campaña</label>
          <input className={styles.input} value={form.campaign} onChange={(e) => set("campaign", e.target.value)} />
        </div>
        <div className={styles.modalActions}>
          <button className={styles.ghostBtn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className={styles.primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Guardando…" : "Crear lead"}
          </button>
        </div>
        <p className={styles.modalHint}>
          Para carga masiva usa “Importar CSV”. Cabeceras admitidas: nombre, teléfono, email,
          fuente, campaña (y cualquier columna extra se guarda como dato del lead).
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`${styles.statCard} ${accent ? styles.statAccent : ""}`} onClick={onClick}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </button>
  );
}

function LeadDrawer({
  id,
  onClose,
  onSaved,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [data, setData] = useState<{ lead: LeadDetail; conversation: ConversationSummary } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    apiFetch<{ lead: LeadDetail; conversation: ConversationSummary }>(`/api/crm/leads/${id}`)
      .then((d) => {
        setData(d);
        setNotes(d.lead.notes ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar"));
  }, [id]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const updated = await apiFetch<LeadDetail>(`/api/crm/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setData((prev) => (prev ? { ...prev, lead: { ...prev.lead, ...updated } } : prev));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar este lead del CRM? No se puede deshacer.")) return;
    setSaving(true);
    try {
      await apiFetch(`/api/crm/leads/${id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  const lead = data?.lead;
  const conv = data?.conversation;
  const rawEntries = lead?.raw ? Object.entries(lead.raw) : [];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHead}>
          <div>
            <h2 className={styles.drawerTitle}>{lead?.name || "Lead"}</h2>
            {lead && <span className={styles.sourceTag}>{sourceLabel(lead.source)}</span>}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {!lead ? (
          <p className={styles.muted}>Cargando…</p>
        ) : (
          <div className={styles.drawerBody}>
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Contacto</h3>
              <Field label="Nombre" value={lead.name} />
              <Field label="Teléfono" value={lead.phone} />
              <Field label="Email" value={lead.email} />
              <Field label="Canal" value={lead.provider} />
            </section>

            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Origen</h3>
              <Field label="Fuente" value={sourceLabel(lead.source)} />
              <Field label="Detalle" value={lead.source_detail} />
              <Field label="Campaña" value={lead.campaign} />
              <Field label="ID externo" value={lead.external_id} />
              <Field label="Opt-in" value={lead.consent_optin ? "Sí" : "No"} />
              <Field label="Fecha de creación" value={fmtDate(lead.created_at)} />
            </section>

            {lead.first_message && (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>Primer mensaje</h3>
                <p className={styles.quote}>{lead.first_message}</p>
              </section>
            )}

            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Estado en el embudo</h3>
              <select
                className={styles.select}
                value={lead.status}
                onChange={(e) => patch({ status: e.target.value })}
                disabled={saving}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </section>

            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Notas</h3>
              <textarea
                className={styles.textarea}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anotaciones internas sobre este lead…"
                rows={3}
              />
              <button
                className={styles.saveBtn}
                onClick={() => patch({ notes })}
                disabled={saving || notes === (lead.notes ?? "")}
              >
                {saving ? "Guardando…" : "Guardar nota"}
              </button>
            </section>

            {conv && (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>Conversación</h3>
                <Field label="Etapa" value={STATUS_LABEL[conv.stage] ?? conv.stage} />
                <Field label="Modo" value={conv.mode} />
                <Field label="IA activa" value={conv.ai_enabled ? "Sí" : "No"} />
                <Field label="Último mensaje" value={fmtDate(conv.last_message_at)} />
                <Link href="/dashboard/inbox" className={styles.linkBtn}>
                  Abrir en Chats →
                </Link>
              </section>
            )}

            {rawEntries.length > 0 && (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>Todos los datos recibidos</h3>
                <div className={styles.rawGrid}>
                  {rawEntries.map(([k, v]) => (
                    <div key={k} className={styles.rawItem}>
                      <span className={styles.rawKey}>{k}</span>
                      <span className={styles.rawVal}>{formatValue(v)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.block}>
              <button className={styles.dangerBtn} onClick={remove} disabled={saving}>
                Eliminar lead
              </button>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value || "—"}</span>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
