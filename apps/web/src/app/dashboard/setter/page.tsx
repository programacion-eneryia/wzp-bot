import SetterForm from "./SetterForm";
import styles from "./setter.module.css";

export default function SetterPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Mi negocio · Mi Setter</span>
      <h1 className={styles.title}>
        Configura tu <span className="serif">setter</span>
      </h1>
      <p className={styles.lead}>
        Cuanto mejor alimentes a tu setter con la información de tu negocio, más
        natural y eficaz cualificará. Todo esto define cómo conversa con tus leads.
      </p>

      <SetterForm />
    </div>
  );
}
