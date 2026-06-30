import TeamPanel from "./TeamPanel";
import styles from "../admin/admin.module.css";

export default function TeamPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Gestión · Equipo</span>
      <h1 className={styles.title}>
        Tu <span className="serif">equipo</span>
      </h1>
      <p className={styles.lead}>
        Crea y gestiona los usuarios de tu organización. Asigna roles (admin o
        closer) y restablece contraseñas.
      </p>
      <TeamPanel />
    </div>
  );
}
