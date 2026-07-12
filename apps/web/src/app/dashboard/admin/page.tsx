import { Suspense } from "react";
import AdminPanel from "./AdminPanel";
import styles from "./admin.module.css";

export default function AdminPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Plataforma · Administración</span>
      <h1 className={styles.title}>
        Panel de <span className="serif">administrador</span>
      </h1>
      <p className={styles.lead}>
        Gestiona subcuentas, usuarios, pagos, costes, entrenamiento base del
        setter y logs. Acceso exclusivo del administrador de la plataforma.
      </p>
      <Suspense fallback={null}>
        <AdminPanel />
      </Suspense>
    </div>
  );
}
