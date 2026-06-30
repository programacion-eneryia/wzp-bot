import Reveal from "@/components/Reveal/Reveal";
import styles from "./page.module.css";

const features = [
  {
    num: "01 / Multicanal",
    title: "WhatsApp, Instagram y Messenger",
    text: "Un solo inbox unificado. Tus leads escriben por donde quieran; el setter responde en todos.",
  },
  {
    num: "02 / Conversación",
    title: "Responde como un humano",
    text: "Mensajes en varias burbujas, retrasos naturales, notas de voz. No se nota que es IA.",
  },
  {
    num: "03 / Agenda",
    title: "Cualifica y agenda solo",
    text: "Detecta leads que cualifican, ofrece horarios libres y reserva la llamada con tu closer.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.glow} aria-hidden />

        <Reveal variant="up">
          <span className={styles.pill}>
            <span className={styles.pillDot} aria-hidden />
            Setter IA · Fase 1
          </span>
        </Reveal>

        <Reveal variant="up" delay={80}>
          <div className={styles.bracket}>
            <span className={styles.tick} data-pos="tl" aria-hidden />
            <span className={styles.tick} data-pos="tr" aria-hidden />
            <span className={styles.tick} data-pos="bl" aria-hidden />
            <span className={styles.tick} data-pos="br" aria-hidden />
            <span className={styles.bracketText}>BOT SETTER IA</span>
          </div>
        </Reveal>

        <Reveal variant="up" delay={160}>
          <h1 className={styles.headline}>
            <span className={styles.line}>
              Convierte tus <span className={styles.hlInline}>DMs</span> en llamadas
            </span>
            <span className={`${styles.line} serif`}>agendadas, en automático.</span>
          </h1>
        </Reveal>

        <Reveal variant="up" delay={240}>
          <p className={styles.sub}>
            Un setter con IA que settea, cualifica y agenda llamadas con los leads de tus
            anuncios <strong>las 24 horas</strong>, hablando como una persona real.
          </p>
        </Reveal>

        <Reveal variant="up" delay={320}>
          <div className={styles.ctaRow}>
            <a className={styles.cta} href="/login">
              Entrar al panel
            </a>
            <a className={styles.ctaGhost} href="#">
              Ver demo
            </a>
          </div>
        </Reveal>
      </section>

      <section className={styles.features}>
        {features.map((f, i) => (
          <Reveal key={f.num} variant="up" delay={i * 100}>
            <article className={styles.card}>
              <span className={styles.cardNum}>{f.num}</span>
              <h3 className={styles.cardTitle}>{f.title}</h3>
              <p className={styles.cardText}>{f.text}</p>
            </article>
          </Reveal>
        ))}
      </section>
    </main>
  );
}
