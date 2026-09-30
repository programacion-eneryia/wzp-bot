import { createClient } from "@/lib/supabase/server";
import Integrations from "./Integrations";
import styles from "./integrations.module.css";

export default async function IntegrationsPage() {
  const supabase = await createClient();

  // Solo los admins ven los tokens y las claves de integración.
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .limit(1)
    .maybeSingle();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .maybeSingle();
  const isAdmin = membership?.role === "admin" || Boolean(profile?.is_platform_admin);

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
