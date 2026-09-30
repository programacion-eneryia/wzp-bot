"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./onboarding.module.css";

type Status = {
  completed_at: string | null;
  steps: { key: string; done: boolean; detail?: string | null }[];
};

const STEPS: {
  key: string;
  title: string;
  text: string;
  href: string;
  cta: string;
  tip?: string;
}[] = [
  {
    key: "channel",
    title: "Conecta un canal",
    text: "WhatsApp, Instagram o Messenger. Es por donde entran y salen los mensajes; sin canal el agente no puede hablar con nadie.",
    href: "/dashboard/channels",
    cta: "Ir a Canales",
    tip: "WhatsApp se conecta escaneando un QR desde el móvil, igual que WhatsApp Web.",
  },
  {
    key: "knowledge",
    title: "Sube el brief de tu negocio",
    text: "Pega o sube tu documento con la oferta, producto, precios, casos de éxito y FAQs. La IA rellena la Base de Conocimiento y configura tus agentes Setter y Soporte.",
    href: "/dashboard/setter",
    cta: "Ir a Base de Conocimiento",
    tip: "Cuanto más completo sea el brief, más natural y precisa será la conversación.",
  },
  {
    key: "agents",
    title: "Revisa tus agentes",
    text: "Comprueba la personalidad, el objetivo y las reglas del Setter y del agente de Soporte, y asigna a cada uno los canales que atiende.",
    href: "/dashboard/agents",
    cta: "Ir a Agentes",
  },
  {
    key: "pipeline",
    title: "Ajusta etapas y etiquetas",
    text: "Las etapas son el recorrido del lead (Nuevo → Cualificando → Calendario enviado → Llamada agendada…). Las etiquetas las aplica la IA según lo que detecta.",
    href: "/dashboard/stages",
    cta: "Ir a Pipelines y Stages",
    tip: "Crea al menos una etiqueta en Etiquetas para que la IA pueda clasificar.",
  },
  {
    key: "playground",
    title: "Prueba la IA",
    text: "Abre una conversación de prueba y habla con tu agente como si fueras un lead. Ajusta lo que no te encaje antes de recibir leads reales.",
    href: "/dashboard/playground",
    cta: "Ir a Probar IA",
  },
  {
    key: "workflows",
    title: "Automatiza seguimientos",
    text: "Crea un workflow para cuando entra un lead, cuando cambia de etapa o cuando no responde: mensajes, esperas, condiciones y pasar a la IA.",
    href: "/dashboard/workflows",
    cta: "Ir a Workflows",
    tip: "Opcional para empezar. Integraciones (GoHighLevel, ManyChat) está en Configuración.",
  },
  {
    key: "live",
    title: "Recibe tu primer lead",
    text: "Cuando un lead escriba a un canal conectado, aparecerá en Chats y en el CRM y el agente le responderá. Desde Chats puedes pausar la IA y tomar el control cuando quieras.",
    href: "/dashboard/inbox",
    cta: "Ir a Chats",
  },
];

export default function Onboarding() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Status>("/api/me/onboarding")
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, []);

  async function finish() {
    setBusy(true);
    try {
      await apiFetch("/api/me/onboarding/complete", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const doneMap = new Map((status?.steps ?? []).map((s) => [s.key, s]));
  const doneCount = STEPS.filter((s) => doneMap.get(s.key)?.done).length;
  const pct = Math.round((doneCount / STEPS.length) * 100);
  const nextIdx = STEPS.findIndex((s) => !doneMap.get(s.key)?.done);

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>Bienvenido a Eneryeter</span>
        <h1 className={styles.title}>Pongamos tu setter a trabajar</h1>
        <p className={styles.lead}>
          Siete pasos cortos. Puedes hacerlos en orden o saltarte los que no necesites; los
          marcamos automáticamente cuando detectamos que ya están hechos. Podrás volver aquí desde
          el menú hasta que lo des por terminado.
        </p>
        <div className={styles.progress}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.progressText}>
            {doneCount} de {STEPS.length} completados
          </span>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <ol className={styles.steps}>
        {STEPS.map((s, i) => {
          const st = doneMap.get(s.key);
          const done = Boolean(st?.done);
          const current = i === nextIdx;
          return (
            <li
              key={s.key}
              className={`${styles.step} ${done ? styles.stepDone : ""} ${current ? styles.stepCurrent : ""}`}
            >
              <div className={styles.stepNum}>{done ? "✓" : i + 1}</div>
              <div className={styles.stepBody}>
                <h2 className={styles.stepTitle}>{s.title}</h2>
                <p className={styles.stepText}>{s.text}</p>
                {s.tip && <p className={styles.stepTip}>{s.tip}</p>}
                {st?.detail && <p className={styles.stepDetail}>{st.detail}</p>}
              </div>
              <div className={styles.stepAction}>
                <Link href={s.href} className={done ? styles.ghostBtn : styles.primaryBtn}>
                  {done ? "Revisar" : s.cta}
                </Link>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className={styles.footer}>
        <button className={styles.ghostBtn} onClick={finish} disabled={busy} type="button">
          Saltar el tour
        </button>
        <button className={styles.primaryBtn} onClick={finish} disabled={busy} type="button">
          {busy ? "Guardando…" : doneCount === STEPS.length ? "Terminar" : "Dar por terminado"}
        </button>
      </footer>
    </div>
  );
}
