import Link from "next/link";
import SetterForm from "./SetterForm";
import styles from "./setter.module.css";

export default function SetterPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Gestión de agentes · Base de Conocimiento</span>
      <h1 className={styles.title}>
        Base de <span className="serif">Conocimiento</span>
      </h1>
      <p className={styles.lead}>
        Todo lo que tus agentes saben de tu negocio: oferta, producto, precios, pruebas
        sociales y el brief completo. Lo comparten todos los agentes; cuanto más detallado esté,
        más natural y eficaz conversan. Los ajustes de la IA (horario, tiempos, silenciados) están
        en{" "}
        <Link href="/dashboard/agents" style={{ color: "inherit" }}>
          Agentes
        </Link>
        .
      </p>

      <SetterForm />
    </div>
  );
}
