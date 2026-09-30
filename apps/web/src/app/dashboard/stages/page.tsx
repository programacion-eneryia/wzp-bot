import Stages from "./Stages";
import styles from "../tags/tags.module.css";

export default function StagesPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Gestión de agentes</span>
      <h1 className={styles.title}>
        Pipelines y <span className="serif">Stages</span>
      </h1>
      <p className={styles.lead}>
        Las etapas por las que pasa cada lead. Puedes renombrarlas, cambiarles el color,
        reordenarlas y añadir las tuyas. Las etapas de sistema (Nuevo, Llamada agendada,
        Ganado…) las usa la IA y las integraciones, así que se pueden renombrar pero no borrar.
        Los agentes de soporte no usan etapas.
      </p>
      <Stages />
    </div>
  );
}
