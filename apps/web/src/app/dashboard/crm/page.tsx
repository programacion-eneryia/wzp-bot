import Crm from "./Crm";
import styles from "./crm.module.css";

export default function CrmPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Mi negocio · CRM</span>
      <h1 className={styles.title}>
        Tus <span className="serif">leads</span>
      </h1>
      <p className={styles.lead}>
        Cada lead que entra por GoHighLevel, ManyChat, un formulario o alta manual queda
        registrado aquí con toda su información antes de que el bot le escriba. Filtra, revisa sus
        datos y sigue su estado en el embudo.
      </p>

      <Crm />
    </div>
  );
}
