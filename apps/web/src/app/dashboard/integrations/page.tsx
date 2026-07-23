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
      <span className={styles.eyebrow}>Sistema · Integraciones</span>
      <h1 className={styles.title}>
        Entrada de <span className="serif">leads</span>
      </h1>
      <p className={styles.lead}>
        Conecta tus campañas de Meta (vía GoHighLevel), Instagram (vía ManyChat) y
        cualquier otra fuente. Cuando entra un lead nuevo, el bot lo registra como
        setter y, si procede, le escribe el primer mensaje automáticamente.
      </p>

      <Integrations isAdmin={isAdmin} />
    </div>
  );
}
