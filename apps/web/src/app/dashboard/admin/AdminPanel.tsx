"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { startImpersonation } from "@/lib/impersonation";
import styles from "./admin.module.css";

type Org = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  seats: number | null;
  member_count: number;
};

type Membership = { organizationId: string; role: string; organizationName: string };
type User = {
  id: string;
  email: string;
  full_name: string | null;
  is_platform_admin: boolean;
  memberships: Membership[];
};

type AuditLog = {
  id: string;
  action: string;
  actor_email: string | null;
  target_type: string | null;
  target_id: string | null;
  organization_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

type CostRow = {
  organization_id: string;
  name: string;
  slug: string;
  plan: string;
  ai_tokens: number;
  ai_cost_usd: number;
  channels: number;
  unipile_cost_usd: number;
  total_cost_usd: number;
};
type Costs = {
  period_start: string;
  unipile_usd_per_account: number;
  rows: CostRow[];
  totals: {
    ai_tokens: number;
    ai_cost_usd: number;
    channels: number;
    unipile_cost_usd: number;
    total_cost_usd: number;
  };
};

type Tab = "orgs" | "users" | "costs" | "audit";

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("orgs");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const loadOrgs = useCallback(async () => {
    setOrgs(await apiFetch<Org[]>("/api/admin/organizations"));
  }, []);
  const loadUsers = useCallback(async () => {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    setUsers(await apiFetch<User[]>(`/api/admin/users${q}`));
  }, [search]);
  const loadAudit = useCallback(async () => {
    setAudit(await apiFetch<AuditLog[]>("/api/admin/audit"));
  }, []);
  const loadCosts = useCallback(async () => {
    setCosts(await apiFetch<Costs>("/api/admin/costs"));
  }, []);

  useEffect(() => {
    loadOrgs().catch((e) => setError(e.message));
  }, [loadOrgs]);
  useEffect(() => {
    if (tab === "users") loadUsers().catch((e) => setError(e.message));
    if (tab === "audit") loadAudit().catch((e) => setError(e.message));
    if (tab === "costs") loadCosts().catch((e) => setError(e.message));
  }, [tab, loadUsers, loadAudit, loadCosts]);

  async function run(fn: () => Promise<unknown>, reload: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  // ---- Organizaciones ----
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgPlan, setOrgPlan] = useState("free");

  function createOrg() {
    if (!orgName.trim() || !orgSlug.trim()) {
      setError("Nombre y slug son obligatorios");
      return;
    }
    void run(
      () =>
        apiFetch("/api/admin/organizations", {
          method: "POST",
          body: JSON.stringify({ name: orgName, slug: orgSlug, plan: orgPlan }),
        }),
      async () => {
        setOrgName("");
        setOrgSlug("");
        await loadOrgs();
      },
    );
  }

  function changePlan(o: Org) {
    const plan = prompt(`Plan para ${o.name}:`, o.plan);
    if (plan == null) return;
    const seatsStr = prompt("Plazas (vacío = sin límite):", o.seats?.toString() ?? "");
    const seats = seatsStr ? Number(seatsStr) : undefined;
    void run(
      () =>
        apiFetch(`/api/admin/organizations/${o.id}`, {
          method: "PATCH",
          body: JSON.stringify({ plan, seats }),
        }),
      loadOrgs,
    );
  }

  function toggleSuspend(o: Org) {
    const suspend = o.status !== "suspended";
    if (!confirm(`${suspend ? "Suspender" : "Reactivar"} ${o.name}?`)) return;
    void run(
      () =>
        apiFetch(`/api/admin/organizations/${o.id}/suspend`, {
          method: "POST",
          body: JSON.stringify({ suspended: suspend }),
        }),
      loadOrgs,
    );
  }

  function deleteOrg(o: Org) {
    if (!confirm(`ELIMINAR ${o.name} y todos sus datos? Esto no se puede deshacer.`)) return;
    void run(() => apiFetch(`/api/admin/organizations/${o.id}`, { method: "DELETE" }), loadOrgs);
  }

  // ---- Usuarios ----
  const [uEmail, setUEmail] = useState("");
  const [uPass, setUPass] = useState("");
  const [uOrg, setUOrg] = useState("");
  const [uRole, setURole] = useState("closer");

  function createUser() {
    if (!uEmail.trim() || !uPass.trim() || !uOrg) {
      setError("Email, contraseña y organización son obligatorios");
      return;
    }
    void run(
      () =>
        apiFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            email: uEmail,
            password: uPass,
            organizationId: uOrg,
            role: uRole,
          }),
        }),
      async () => {
        setUEmail("");
        setUPass("");
        await loadUsers();
      },
    );
  }

  function resetPw(u: User) {
    const password = prompt(`Nueva contraseña para ${u.email}:`);
    if (!password) return;
    void run(
      () => apiFetch(`/api/admin/users/${u.id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
      loadUsers,
    );
  }

  function ban(u: User, banned: boolean) {
    if (!confirm(`${banned ? "Desactivar" : "Reactivar"} a ${u.email}?`)) return;
    void run(
      () => apiFetch(`/api/admin/users/${u.id}/ban`, { method: "POST", body: JSON.stringify({ banned }) }),
      loadUsers,
    );
  }

  function delUser(u: User) {
    if (!confirm(`ELIMINAR a ${u.email}? Esto no se puede deshacer.`)) return;
    void run(() => apiFetch(`/api/admin/users/${u.id}`, { method: "DELETE" }), loadUsers);
  }

  function changeRole(u: User, m: Membership) {
    const role = m.role === "admin" ? "closer" : "admin";
    void run(
      () =>
        apiFetch(`/api/admin/users/${u.id}/role`, {
          method: "POST",
          body: JSON.stringify({ organizationId: m.organizationId, role }),
        }),
      loadUsers,
    );
  }

  function moveUser(u: User, m: Membership) {
    const toOrg = orgs.find((o) => o.slug === prompt(`Slug de la organización destino:`));
    if (!toOrg) {
      setError("Organización destino no encontrada");
      return;
    }
    void run(
      () =>
        apiFetch(`/api/admin/users/${u.id}/move`, {
          method: "POST",
          body: JSON.stringify({
            fromOrganizationId: m.organizationId,
            toOrganizationId: toOrg.id,
            role: m.role,
          }),
        }),
      loadUsers,
    );
  }

  async function impersonate(u: User) {
    setBusy(true);
    setError(null);
    try {
      const { token_hash, email } = await apiFetch<{ token_hash: string; email: string }>(
        `/api/admin/users/${u.id}/impersonate`,
        { method: "POST" },
      );
      await startImpersonation(token_hash, email);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al impersonar");
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs}>
        {(["orgs", "users", "costs", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "orgs"
              ? "Organizaciones"
              : t === "users"
                ? "Usuarios"
                : t === "costs"
                  ? "Costes"
                  : "Auditoría"}
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {tab === "orgs" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Crear organización</h2>
            <div className={styles.formRow}>
              <input className={styles.input} placeholder="Nombre" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              <input className={styles.input} placeholder="slug" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} />
              <input className={styles.input} placeholder="plan" value={orgPlan} onChange={(e) => setOrgPlan(e.target.value)} />
              <button className={styles.saveBtn} onClick={createOrg} disabled={busy}>
                Crear
              </button>
            </div>
          </section>

          <ul className={styles.list}>
            {orgs.map((o) => (
              <li key={o.id} className={styles.item}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>
                    {o.name}{" "}
                    {o.status === "suspended" && <span className={styles.badgeWarn}>suspendida</span>}
                  </span>
                  <span className={styles.hint}>
                    {o.slug} · plan {o.plan} · {o.member_count} usuarios{o.seats ? ` / ${o.seats}` : ""}
                  </span>
                </div>
                <div className={styles.actions}>
                  <button className={styles.ghostBtn} onClick={() => changePlan(o)} disabled={busy}>
                    Plan/plazas
                  </button>
                  <button className={styles.ghostBtn} onClick={() => toggleSuspend(o)} disabled={busy}>
                    {o.status === "suspended" ? "Reactivar" : "Suspender"}
                  </button>
                  <button className={styles.dangerBtn} onClick={() => deleteOrg(o)} disabled={busy}>
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "users" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Crear usuario</h2>
            <div className={styles.formRow}>
              <input className={styles.input} placeholder="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} />
              <input className={styles.input} placeholder="contraseña" value={uPass} onChange={(e) => setUPass(e.target.value)} />
              <select className={styles.input} value={uOrg} onChange={(e) => setUOrg(e.target.value)}>
                <option value="">Organización…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <select className={styles.input} value={uRole} onChange={(e) => setURole(e.target.value)}>
                <option value="closer">closer</option>
                <option value="admin">admin</option>
              </select>
              <button className={styles.saveBtn} onClick={createUser} disabled={busy}>
                Crear
              </button>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.formRow}>
              <input
                className={styles.input}
                placeholder="Buscar por email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className={styles.ghostBtn} onClick={() => loadUsers()} disabled={busy}>
                Buscar
              </button>
            </div>
          </section>

          <ul className={styles.list}>
            {users.map((u) => (
              <li key={u.id} className={styles.item}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>
                    {u.email} {u.is_platform_admin && <span className={styles.badge}>plataforma</span>}
                  </span>
                  <span className={styles.hint}>
                    {u.memberships.length === 0
                      ? "sin organización"
                      : u.memberships.map((m) => `${m.organizationName} (${m.role})`).join(", ")}
                  </span>
                  <div className={styles.subActions}>
                    {u.memberships.map((m) => (
                      <span key={m.organizationId} className={styles.subRow}>
                        <button className={styles.linkBtn} onClick={() => changeRole(u, m)} disabled={busy}>
                          cambiar rol en {m.organizationName}
                        </button>
                        <button className={styles.linkBtn} onClick={() => moveUser(u, m)} disabled={busy}>
                          mover
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.actions}>
                  <button className={styles.ghostBtn} onClick={() => impersonate(u)} disabled={busy}>
                    Impersonar
                  </button>
                  <button className={styles.ghostBtn} onClick={() => resetPw(u)} disabled={busy}>
                    Reset pass
                  </button>
                  <button className={styles.ghostBtn} onClick={() => ban(u, true)} disabled={busy}>
                    Desactivar
                  </button>
                  <button className={styles.dangerBtn} onClick={() => delUser(u)} disabled={busy}>
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "costs" && (
        <>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Costes del mes en curso</h2>
            <span className={styles.hint}>
              Consumo de IA (tokens + coste real de OpenRouter) y cuentas conectadas de Unipile
              (a {costs ? `$${costs.unipile_usd_per_account}` : "$5"}/cuenta). Desde{" "}
              {costs ? new Date(costs.period_start).toLocaleDateString("es-ES") : "—"}.
            </span>
          </section>

          {costs && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Organización</th>
                    <th>Tokens IA</th>
                    <th>Coste IA</th>
                    <th>Canales</th>
                    <th>Coste Unipile</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.rows.map((r) => (
                    <tr key={r.organization_id}>
                      <td className={styles.itemName}>{r.name}</td>
                      <td>{r.ai_tokens.toLocaleString("es-ES")}</td>
                      <td>${r.ai_cost_usd.toFixed(2)}</td>
                      <td>{r.channels}</td>
                      <td>${r.unipile_cost_usd.toFixed(2)}</td>
                      <td>
                        <strong>${r.total_cost_usd.toFixed(2)}</strong>
                      </td>
                    </tr>
                  ))}
                  <tr className={styles.totalRow}>
                    <td>
                      <strong>TOTAL</strong>
                    </td>
                    <td>{costs.totals.ai_tokens.toLocaleString("es-ES")}</td>
                    <td>${costs.totals.ai_cost_usd.toFixed(2)}</td>
                    <td>{costs.totals.channels}</td>
                    <td>${costs.totals.unipile_cost_usd.toFixed(2)}</td>
                    <td>
                      <strong>${costs.totals.total_cost_usd.toFixed(2)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {costs && costs.rows.length === 0 && <p className={styles.hint}>Sin datos de consumo.</p>}
        </>
      )}

      {tab === "audit" && (
        <ul className={styles.list}>
          {audit.map((a) => (
            <li key={a.id} className={styles.auditRow}>
              <span className={styles.badge}>{a.action}</span>
              <span className={styles.hint}>
                {a.actor_email ?? "—"} · {new Date(a.created_at).toLocaleString("es-ES")}
              </span>
            </li>
          ))}
          {audit.length === 0 && <p className={styles.hint}>Sin registros.</p>}
        </ul>
      )}
    </div>
  );
}
