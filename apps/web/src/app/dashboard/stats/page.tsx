import Stats from "./Stats";
import styles from "./stats.module.css";

export default function StatsPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Análisis · Estadísticas</span>
      <h1 className={styles.title}>
        Tus <span className="serif">métricas</span>
      </h1>
      <p className={styles.lead}>
        Todo lo relevante en un vistazo: leads por estado y fuente, etiquetas, llamadas
        agendadas y ratios de conversión.
      </p>

      <Stats />
    </div>
  );
}
