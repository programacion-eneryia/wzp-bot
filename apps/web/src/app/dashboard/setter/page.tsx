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
      <span className={styles.eyebrow}>Gestión de agentes · Base de Conocimiento</span>
      <h1 className={styles.title}>
        Base de <span className="serif">Conocimiento</span>
      </h1>
      <p className={styles.lead}>
        Todo lo que tus agentes saben de tu negocio: oferta, producto, precios, pruebas
        sociales y el brief completo. Lo comparten todos los agentes; cuanto mejor esté, más
        natural y eficaz conversan.
      </p>

      <SetterForm isAdmin={isAdmin} />
    </div>
  );
}
