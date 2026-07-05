import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton/LogoutButton";
import OrgSwitcher from "@/components/OrgSwitcher/OrgSwitcher";
import ImpersonationBanner from "@/components/ImpersonationBanner/ImpersonationBanner";
import { createClient } from "@/lib/supabase/server";
import styles from "./dashboard.module.css";

type OrgInfo = { name: string; slug: string; plan: string } | null;

type NavItem = { label: string; href?: string };

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

  // Navegación dinámica según permisos.
  const NAV: { label: string; items: NavItem[] }[] = [
    {
      label: "Mi negocio",
      items: [
        { label: "CRM", href: "/dashboard/crm" },
        { label: "Chats", href: "/dashboard/inbox" },
        { label: "Probar IA", href: "/dashboard/playground" },
        { label: "Mi Setter", href: "/dashboard/setter" },
        { label: "Calendarios", href: "/dashboard/calendar" },
      ],
    },
    {
      label: "Gestión",
      items: [
        { label: "Etiquetas" },
        ...(role === "admin" || isPlatformAdmin
          ? [{ label: "Equipo", href: "/dashboard/team" }]
          : [{ label: "Equipo" }]),
      ],
    },
    {
      label: "Análisis",
      items: [{ label: "Estadísticas" }, { label: "Exportar" }],
    },
    {
      label: "Sistema",
      items: [
        { label: "Canales", href: "/dashboard/channels" },
        { label: "Integraciones", href: "/dashboard/integrations" },
        { label: "Ajustes" },
      ],
    },
    ...(isPlatformAdmin
      ? [
          {
            label: "Plataforma",
            items: [{ label: "Administración", href: "/dashboard/admin" }],
          },
        ]
      : []),
  ];

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandName}>WZP</span>
          <span className={styles.brandDot}>Setter IA</span>
        </div>

        <nav>
          <Link href="/dashboard" className={styles.navItem}>
            Inicio
          </Link>
          {NAV.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <span className={styles.navLabel}>{group.label}</span>
              {group.items.map((item) =>
                item.href ? (
                  <Link key={item.label} href={item.href} className={styles.navItem}>
                    {item.label}
                  </Link>
                ) : (
                  <div key={item.label} className={styles.navItem}>
                    {item.label}
                    <span className={styles.navSoon}>pronto</span>
                  </div>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className={styles.userBox}>
          <div className={styles.userInfo}>
            <span className={styles.userEmail}>{user.email}</span>
            <span className={styles.userRole}>{role}</span>
          </div>
          <LogoutButton />
        </div>
      </aside>

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
