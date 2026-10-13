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
        Cada pipeline tiene sus propias etapas y cada agente trabaja en uno: el Setter en el
        embudo comercial y Soporte en el suyo. Puedes crear más pipelines, renombrar, recolorear,
        reordenar y añadir etapas. Las etapas de sistema del pipeline principal (Nuevo, Llamada
        agendada, Ganado…) las usan la IA y las integraciones, así que se pueden renombrar pero no
        borrar.
      </p>
      <Stages />
    </div>
  );
}
