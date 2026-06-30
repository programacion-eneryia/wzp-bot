import CalendarManager from "./CalendarManager";
import styles from "./calendar.module.css";

export default function CalendarPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Mi negocio · Calendarios</span>
      <h1 className={styles.title}>
        Agenda de <span className="serif">llamadas</span>
      </h1>
      <p className={styles.lead}>
        Conecta tu calendario (Google u Outlook) para que el bot agende llamadas.
        Puedes dejar que ofrezca huecos reales según tu disponibilidad o que
        comparta tu enlace de agenda. El bot detecta automáticamente cuándo un
        lead ha agendado y lo etiqueta como “llamada agendada”.
      </p>

      <CalendarManager />
    </div>
  );
}
