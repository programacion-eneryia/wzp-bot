import Integrations from "./Integrations";
import styles from "./integrations.module.css";

export default function IntegrationsPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Sistema · Integraciones</span>
      <h1 className={styles.title}>
        Entrada de <span className="serif">leads</span>
      </h1>
      <p className={styles.lead}>
        Conecta tus campañas de Meta (vía GoHighLevel), Instagram (vía ManyChat) y
        cualquier otra fuente. Cuando entra un lead nuevo, el bot lo registra como
        setter y, si procede, le escribe el primer mensaje automáticamente.
      </p>

      <Integrations />
    </div>
  );
}
