"use client";

import styles from "./OrgSwitcher.module.css";

type Membership = { organization_id: string; name: string; role: string };

export default function OrgSwitcher({
  memberships,
  activeId,
}: {
  memberships: Membership[];
  activeId: string | null;
}) {
  if (!memberships || memberships.length <= 1) return null;

  function change(id: string) {
    // SameSite=None: también debe guardarse con la app embebida en GHL (iframe).
    const crossSite = location.protocol === "https:" ? "; samesite=none; secure" : "";
    document.cookie = `org_id=${encodeURIComponent(id)}; path=/; max-age=31536000${crossSite}`;
    window.location.reload();
  }

  return (
    <select
      className={styles.switcher}
      value={activeId ?? ""}
      onChange={(e) => change(e.target.value)}
      title="Cambiar de organización"
    >
      {memberships.map((m) => (
        <option key={m.organization_id} value={m.organization_id}>
          {m.name} ({m.role})
        </option>
      ))}
    </select>
  );
}
