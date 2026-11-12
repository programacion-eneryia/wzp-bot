import { getActiveRole } from "@/lib/role";
import Agents from "./Agents";
import styles from "./agents.module.css";

export default async function AgentsPage() {
  // Solo los admins editan los agentes (y ven el modelo LLM); un closer los consulta.
  const { isAdmin } = await getActiveRole();

  return (
    <div>
      <span className={styles.eyebrow}>Gestión de agentes</span>
      <h1 className={styles.title}>
        Tus <span className="serif">agentes</span> de IA
      </h1>
      <p className={styles.lead}>
        Cada agente tiene su propia personalidad, objetivo, reglas, pipeline y ajustes, y atiende
        los canales que le asignes. Todos comparten la Base de Conocimiento de tu negocio. El{" "}
        <strong>Setter</strong> cualifica y agenda; <strong>Soporte</strong> atiende a clientes en su
        propio pipeline.
      </p>
      <Agents isAdmin={isAdmin} />
    </div>
  );
}
