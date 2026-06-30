import Playground from "./Playground";
import styles from "./playground.module.css";

export default function PlaygroundPage() {
  return (
    <div>
      <span className={styles.eyebrow}>Mi negocio · Probar IA</span>
      <h1 className={styles.title}>
        Prueba tu <span className="serif">setter</span>
      </h1>
      <p className={styles.lead}>
        Crea una conversación de prueba y habla con tu setter como si fueras un
        lead. Así verificas cómo responde antes de conectarlo a un canal real.
      </p>

      <Playground />
    </div>
  );
}
