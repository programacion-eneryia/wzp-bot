import { createClient } from "@/lib/supabase/server";
import Agents from "./Agents";
import styles from "./agents.module.css";

export default async function AgentsPage() {
  const supabase = await createClient();

  // Solo los admins ven/gestionan el modelo LLM.
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
      <span className={styles.eyebrow}>Gestión de agentes</span>
      <h1 className={styles.title}>
        Tus <span className="serif">agentes</span> de IA
      </h1>
      <p className={styles.lead}>
        Cada agente tiene su propia personalidad, objetivo y reglas, y atiende los canales que le
        asignes. Todos comparten la Base de Conocimiento de tu negocio. El <strong>Setter</strong>{" "}
        cualifica y agenda; <strong>Soporte</strong> atiende a clientes sin pasar por el embudo.
      </p>
      <Agents isAdmin={isAdmin} />
    </div>
  );
}
