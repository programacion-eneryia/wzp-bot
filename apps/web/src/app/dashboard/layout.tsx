import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar/Sidebar";
import OrgSwitcher from "@/components/OrgSwitcher/OrgSwitcher";
import ImpersonationBanner from "@/components/ImpersonationBanner/ImpersonationBanner";
import { createClient } from "@/lib/supabase/server";
import styles from "./dashboard.module.css";

type OrgInfo = { name: string; slug: string; plan: string } | null;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isPlatformAdmin = Boolean(profile?.is_platform_admin);

  // Todas las organizaciones del usuario (multi-org).
  const { data: memRows } = await supabase
    .from("memberships")
    .select("organization_id, role, organizations(name, slug, plan)")
    .eq("user_id", user.id);

  const memberships = (memRows ?? []).map((m) => {
    const o = m.organizations as unknown as OrgInfo;
    return {
      organization_id: m.organization_id as string,
      role: m.role as string,
      name: o?.name ?? "Org",
      plan: o?.plan ?? "free",
      slug: o?.slug ?? "",
    };
  });

  const cookieOrg = (await cookies()).get("org_id")?.value ?? null;
  const active =
    memberships.find((m) => m.organization_id === cookieOrg) ?? memberships[0] ?? null;
  const role = active?.role ?? (isPlatformAdmin ? "platform" : "—");
  const org: OrgInfo = active ? { name: active.name, slug: active.slug, plan: active.plan } : null;

  // Onboarding: solo para organizaciones nuevas (las existentes ya lo tienen
  // marcado como completado en la migración 0025).
  let onboardingDone = true;
  if (active && !isPlatformAdmin) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("onboarding_completed_at")
      .eq("id", active.organization_id)
      .maybeSingle();
    onboardingDone = Boolean(orgRow?.onboarding_completed_at);
  }

  const homeHref = isPlatformAdmin ? "/dashboard/admin" : "/dashboard";

  return (
    <div className={styles.shell} data-app-shell>
      <Sidebar
        email={user.email ?? ""}
        role={role}
        isPlatformAdmin={isPlatformAdmin}
        isAdmin={role === "admin"}
        onboardingDone={onboardingDone}
        homeHref={homeHref}
      />

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.orgName}>{org?.name ?? "Sin organización"}</span>
            {org && <span className={styles.orgPlan}>{org.plan}</span>}
          </div>
          <OrgSwitcher
            memberships={memberships.map((m) => ({
              organization_id: m.organization_id,
              name: m.name,
              role: m.role,
            }))}
            activeId={active?.organization_id ?? null}
          />
        </header>
        <div className={styles.content}>
          <ImpersonationBanner />
          {children}
        </div>
      </div>
    </div>
  );
}
