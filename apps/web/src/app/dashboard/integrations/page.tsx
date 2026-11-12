import { getActiveRole } from "@/lib/role";
import Integrations from "./Integrations";
import styles from "./integrations.module.css";

export default async function IntegrationsPage() {
  // Solo los admins ven los tokens y las claves de integración.
  const { isAdmin } = await getActiveRole();

  return (
    <div>
      <span className={styles.eyebrow}>Configuración · Integraciones</span>
      <h1 className={styles.title}>
        Integraciones
      </h1>
      <p className={styles.lead}>
        Conecta las herramientas por las que entran tus leads: GoHighLevel, ManyChat o
        cualquier webhook. Elige una app para ver sus URLs e instrucciones.
      </p>

      <Integrations isAdmin={isAdmin} />
    </div>
  );
}
