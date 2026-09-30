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
        Leads con los que el agente ha hablado, por etapa, canal y agente; calendarios enviados,
        llamadas agendadas y ratios de conversión. Los chats de soporte no entran en el embudo.
      </p>

      <Stats />
    </div>
  );
}
