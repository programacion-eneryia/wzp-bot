"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./mobileGate.module.css";

/** Secciones utilizables desde el móvil; el resto se gestiona desde ordenador. */
const MOBILE_PREFIXES = ["/dashboard/inbox", "/dashboard/crm", "/dashboard/profile"];

export default function MobileGate({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const allowed = !enabled || MOBILE_PREFIXES.some((p) => pathname.startsWith(p));
  if (allowed) return <>{children}</>;

  return (
    <>
      <div className={styles.notice}>
        <h2 className={styles.title}>Disponible en ordenador</h2>
        <p className={styles.text}>
          Desde el móvil puedes atender tus chats y consultar el CRM. El resto de la
          configuración se gestiona desde un ordenador.
        </p>
        <div className={styles.actions}>
          <Link href="/dashboard/inbox" className={styles.primary}>
            Ir a Chats
          </Link>
          <Link href="/dashboard/crm" className={styles.ghost}>
            Ir al CRM
          </Link>
        </div>
      </div>
      <div className={styles.desktop}>{children}</div>
    </>
  );
}
