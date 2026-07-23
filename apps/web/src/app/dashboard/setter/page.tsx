import { createClient } from "@/lib/supabase/server";
import SetterForm from "./SetterForm";
import styles from "./setter.module.css";

export default async function SetterPage() {
  const supabase = await createClient();

  // Solo los admins ven/gestionan el modelo LLM y el control de tokens.
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
      <span className={styles.eyebrow}>Mi negocio · Mi Setter</span>
      <h1 className={styles.title}>
        Configura tu <span className="serif">setter</span>
      </h1>
      <p className={styles.lead}>
        Cuanto mejor alimentes a tu setter con la información de tu negocio, más
        natural y eficaz cualificará. Todo esto define cómo conversa con tus leads.
      </p>

      <SetterForm isAdmin={isAdmin} />
    </div>
  );
}
