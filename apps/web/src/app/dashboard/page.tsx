import { createClient } from "@/lib/supabase/server";
import styles from "./overview.module.css";

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      <span className={styles.eyebrow}>Panel · Inicio</span>
      <h1 className={styles.title}>
        Bienvenido a tu <span className="serif">centro de control</span>
      </h1>
      <p className={styles.lead}>
        La fundación está lista: estás autenticado y los datos están aislados por
        organización con Row Level Security. Desde aquí iremos activando los módulos.
      </p>

      <div className={styles.grid}>
        <article className={styles.card}>
          <span className={styles.cardNum}>Sesión</span>
          <p className={styles.cardValue}>{user?.email}</p>
          <p className={styles.cardText}>Usuario autenticado correctamente.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.cardNum}>Seguridad</span>
          <p className={styles.cardValue}>RLS activo</p>
          <p className={styles.cardText}>Solo ves los datos de tu organización.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.cardNum}>Siguiente</span>
          <p className={styles.cardValue}>Conectar WhatsApp</p>
          <p className={styles.cardText}>Inbox unificado vía Unipile (Fase 2).</p>
        </article>
      </div>
    </div>
  );
}
