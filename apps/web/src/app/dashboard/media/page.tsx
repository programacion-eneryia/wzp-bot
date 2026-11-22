import { getActiveRole } from "@/lib/role";
import Media from "./Media";
import styles from "./media.module.css";

export default async function MediaPage() {
  // Solo los admins suben y editan archivos; un closer los consulta y los envía desde el chat.
  const { isAdmin } = await getActiveRole();
  return (
    <div>
      <span className={styles.eyebrow}>Gestión de los agentes</span>
      <h1 className={styles.title}>
        Archivos que envía <span className="serif">el bot</span>
      </h1>
      <p className={styles.lead}>
        Sube audios, vídeos, imágenes o documentos y explica cuándo conviene enviarlos.
        La IA los manda en el momento adecuado de la conversación (p.ej. &quot;cuando
        pregunte por el precio, envía el vídeo de la oferta&quot;). También puedes
        enviarlos desde un workflow o a mano desde cualquier chat.
      </p>
      <Media isAdmin={isAdmin} />
    </div>
  );
}
