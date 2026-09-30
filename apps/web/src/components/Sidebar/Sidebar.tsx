"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Logo from "@/components/Brand/Logo";
import { createClient } from "@/lib/supabase/client";
import { getTheme, toggleTheme, type Theme } from "@/lib/theme";
import styles from "./sidebar.module.css";

export type NavItem = { label: string; href: string; icon?: string; badge?: string };
export type NavGroup = { label?: string; items: NavItem[] };

type Props = {
  email: string;
  role: string;
  isPlatformAdmin: boolean;
  isAdmin: boolean;
  onboardingDone: boolean;
  homeHref: string;
};

/** Rutas que viven dentro de "Configuración" (barra lateral propia). */
const SETTINGS_PREFIXES = [
  "/dashboard/channels",
  "/dashboard/integrations",
  "/dashboard/setter",
  "/dashboard/playground",
  "/dashboard/calendar",
];

const SETTINGS_NAV: NavGroup[] = [
  {
    items: [
      { label: "Canales", href: "/dashboard/channels", icon: "◎" },
      { label: "Integraciones", href: "/dashboard/integrations", icon: "⇄" },
      { label: "Base de Conocimiento", href: "/dashboard/setter", icon: "▤" },
      { label: "Probar IA", href: "/dashboard/playground", icon: "▷" },
      { label: "Calendarios", href: "/dashboard/calendar", icon: "▦" },
    ],
  },
];

const ADMIN_NAV: NavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { label: "Subcuentas", href: "/dashboard/admin" },
      { label: "Usuarios", href: "/dashboard/admin?tab=users" },
      { label: "Pagos", href: "/dashboard/admin?tab=billing" },
      { label: "Costes", href: "/dashboard/admin?tab=costs" },
      { label: "Entrenamiento", href: "/dashboard/admin?tab=training" },
      { label: "Logs de errores", href: "/dashboard/admin?tab=errors" },
      { label: "Auditoría", href: "/dashboard/admin?tab=audit" },
    ],
  },
];

function mainNav(isAdmin: boolean, onboardingDone: boolean): NavGroup[] {
  const top: NavItem[] = [];
  if (!onboardingDone) {
    top.push({ label: "Onboarding", href: "/dashboard/onboarding", icon: "✦", badge: "nuevo" });
  }
  top.push({ label: "Dashboard", href: "/dashboard", icon: "▣" });
  const groups: NavGroup[] = [
    { items: top },
    {
      label: "Zona de trabajo",
      items: [
        { label: "CRM", href: "/dashboard/crm", icon: "▤" },
        { label: "Chats", href: "/dashboard/inbox", icon: "◌" },
      ],
    },
    {
      label: "Gestión de los agentes",
      items: [
        { label: "Agentes", href: "/dashboard/agents", icon: "◍" },
        { label: "Workflows", href: "/dashboard/workflows", icon: "⤳" },
        { label: "Pipelines y Stages", href: "/dashboard/stages", icon: "⋯" },
        { label: "Etiquetas", href: "/dashboard/tags", icon: "◈" },
      ],
    },
    {
      label: "Análisis",
      items: [{ label: "Estadísticas", href: "/dashboard/stats", icon: "▥" }],
    },
  ];
  const bottom: NavItem[] = [];
  if (isAdmin) bottom.push({ label: "Equipo", href: "/dashboard/team", icon: "☺" });
  bottom.push({ label: "Configuración", href: "/dashboard/channels", icon: "⚙" });
  groups.push({ items: bottom });
  return groups;
}

export default function Sidebar({
  email,
  role,
  isPlatformAdmin,
  isAdmin,
  onboardingDone,
  homeHref,
}: Props) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const inSettings = !isPlatformAdmin && SETTINGS_PREFIXES.some((p) => pathname.startsWith(p));
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(getTheme());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  async function logout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const groups = isPlatformAdmin ? ADMIN_NAV : inSettings ? SETTINGS_NAV : mainNav(isAdmin, onboardingDone);

  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (path === "/dashboard") return pathname === "/dashboard";
    if (!pathname.startsWith(path)) return false;
    if (query && typeof window !== "undefined") {
      return window.location.search.includes(query);
    }
    return true;
  };

  return (
    <aside className={styles.sidebar}>
      <Link href={homeHref} className={styles.brand}>
        <Logo size={30} />
        <span className={styles.brandText}>
          <span className={styles.brandName}>Eneryeter</span>
          <span className={styles.brandSub}>Setter con IA</span>
        </span>
      </Link>

      <nav className={styles.nav}>
        {inSettings && (
          <>
            <Link href="/dashboard" className={styles.backLink}>
              ← Volver al panel
            </Link>
            <span className={styles.sectionTitle}>Configuración</span>
          </>
        )}
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className={styles.group}>
            {group.label && <span className={styles.groupLabel}>{group.label}</span>}
            {group.items.map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={`${styles.item} ${isActive(item.href) ? styles.itemActive : ""}`}
              >
                {item.icon && <span className={styles.icon}>{item.icon}</span>}
                <span className={styles.itemLabel}>{item.label}</span>
                {item.badge && <span className={styles.badge}>{item.badge}</span>}
              </Link>
            ))}
            {!isPlatformAdmin && !inSettings && gi === 0 && <hr className={styles.divider} />}
          </div>
        ))}
      </nav>

      <div className={styles.userBox} ref={menuRef}>
        {menuOpen && (
          <div className={styles.menu} role="menu">
            <div className={styles.menuHead}>
              <span className={styles.menuEmail}>{email}</span>
              <span className={styles.menuRole}>{role}</span>
            </div>
            {!isPlatformAdmin && (
              <Link
                href="/dashboard/channels"
                className={styles.menuItem}
                onClick={() => setMenuOpen(false)}
              >
                <span className={styles.icon}>⚙</span> Configuración
              </Link>
            )}
            <Link
              href="/dashboard/profile"
              className={styles.menuItem}
              onClick={() => setMenuOpen(false)}
            >
              <span className={styles.icon}>☺</span> Mi perfil
            </Link>
            <button
              className={styles.menuItem}
              onClick={() => setTheme(toggleTheme())}
              type="button"
            >
              <span className={styles.icon}>{theme === "light" ? "☾" : "☼"}</span>
              {theme === "light" ? "Modo noche" : "Modo día"}
            </button>
            <button
              className={`${styles.menuItem} ${styles.menuDanger}`}
              onClick={logout}
              disabled={loggingOut}
              type="button"
            >
              <span className={styles.icon}>⎋</span> {loggingOut ? "Saliendo…" : "Cerrar sesión"}
            </button>
          </div>
        )}
        <button
          className={`${styles.userBtn} ${menuOpen ? styles.userBtnOpen : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className={styles.avatar}>{email.slice(0, 1).toUpperCase()}</span>
          <span className={styles.userInfo}>
            <span className={styles.userEmail}>{email}</span>
            <span className={styles.userRole}>{role}</span>
          </span>
          <span className={styles.gear} aria-hidden="true">
            ⚙
          </span>
        </button>
      </div>
    </aside>
  );
}
