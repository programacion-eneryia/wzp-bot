"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./ChannelAlerts.module.css";

/** Canal que estuvo conectado y se ha caído (lo devuelve GET /api/channels/alerts). */
export type ChannelAlert = {
  id: string;
  provider: "whatsapp" | "instagram" | "messenger" | "linkedin" | "telegram";
  status: "error" | "disconnected";
  display_name: string | null;
  last_error: string | null;
  since: string;
  can_reconnect: boolean;
};

const PROVIDER_LABEL: Record<ChannelAlert["provider"], string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  linkedin: "LinkedIn",
  telegram: "Telegram",
};

/** Cada cuánto se consulta al servidor si hay canales caídos. */
const POLL_MS = 60_000;

function sinceText(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 2) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} días`;
}

function channelName(a: ChannelAlert): string {
  const prov = PROVIDER_LABEL[a.provider] ?? "canal";
  if (!a.display_name) return prov;
  // Un número de teléfono se lee mejor con el "+".
  const name = /^\d{8,15}$/.test(a.display_name) ? `+${a.display_name}` : a.display_name;
  return `${prov} (${name})`;
}

/** Clave para recordar que el usuario ya minimizó esta alerta (vuelve si cambia el estado). */
function dismissKey(alerts: ChannelAlert[]): string {
  return "channel-alerts:" + alerts.map((a) => `${a.id}@${a.since}`).sort().join(",");
}

/**
 * Aviso global, visible en toda la app, cuando un canal que estaba conectado
 * se desconecta (nos lo dice el proveedor). Permite reconectar desde aquí
 * mismo sin pasar por Configuración.
 */
export default function ChannelAlerts({
  initial,
  isAdmin,
}: {
  initial: ChannelAlert[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<ChannelAlert[]>(initial);
  const [minimized, setMinimized] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef(dismissKey(initial));

  // Si el estado cambia (nuevo canal caído, otro que se recupera), la alerta
  // vuelve a mostrarse aunque estuviera minimizada.
  useEffect(() => {
    const key = dismissKey(alerts);
    setMinimized(Boolean(alerts.length) && sessionStorage.getItem(key) === "1");
    if (key !== lastKey.current) {
      lastKey.current = key;
      // Refresca el layout (el punto rojo de la barra lateral se calcula en el servidor).
      router.refresh();
    }
  }, [alerts, router]);

  const refresh = useCallback(async () => {
    try {
      const next = await apiFetch<ChannelAlert[]>("/api/channels/alerts");
      setAlerts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch {
      // Sin red o sin sesión: mantenemos lo último que sabíamos.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (alerts.length === 0) return null;

  async function reconnect(a: ChannelAlert) {
    setBusy(a.id);
    setError(null);
    try {
      const { url } = a.can_reconnect
        ? await apiFetch<{ url: string }>(`/api/channels/${a.id}/reconnect`, { method: "POST" })
        : await apiFetch<{ url: string }>("/api/channels/connect", {
            method: "POST",
            body: JSON.stringify({ provider: a.provider }),
          });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la reconexión");
      setBusy(null);
    }
  }

  function minimize() {
    sessionStorage.setItem(dismissKey(alerts), "1");
    setMinimized(true);
  }

  function expand() {
    sessionStorage.removeItem(dismissKey(alerts));
    setMinimized(false);
  }

  if (minimized) {
    return (
      <button type="button" className={styles.pill} onClick={expand} aria-live="polite">
        <span className={styles.dot} aria-hidden />
        {alerts.length === 1
          ? `${channelName(alerts[0])} desconectado`
          : `${alerts.length} canales desconectados`}
        <span className={styles.pillAction}>Ver</span>
      </button>
    );
  }

  return (
    <div className={styles.banner} role="alert" aria-live="assertive">
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden />
        <strong className={styles.title}>
          {alerts.length === 1
            ? `Tu ${channelName(alerts[0])} se ha desconectado`
            : `${alerts.length} canales se han desconectado`}
        </strong>
        <button type="button" className={styles.close} onClick={minimize} aria-label="Minimizar aviso">
          ×
        </button>
      </div>
      <p className={styles.text}>
        Mientras tanto el asistente no recibe ni envía mensajes por{" "}
        {alerts.length === 1 ? "este canal" : "estos canales"}.{" "}
        {isAdmin
          ? alerts.every((a) => a.can_reconnect)
            ? "Reconectar lleva un minuto: se abre el código QR o el inicio de sesión y los chats se conservan."
            : "Vuelve a conectarlo para que todo siga funcionando."
          : "Avisa a un administrador para que lo reconecte desde Configuración."}
      </p>
      <ul className={styles.list}>
        {alerts.map((a) => (
          <li key={a.id} className={styles.item}>
            <span className={styles.itemName}>
              {channelName(a)}
              <span className={styles.since}> · {a.status === "disconnected" ? "cuenta eliminada" : "sesión cerrada"} {sinceText(a.since)}</span>
            </span>
            {isAdmin && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => void reconnect(a)}
                disabled={busy !== null}
              >
                {busy === a.id ? "Abriendo…" : a.can_reconnect ? "Reconectar ahora" : "Conectar de nuevo"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.foot}>
        {error && <span className={styles.error}>{error}</span>}
        <Link href="/dashboard/channels" className={styles.link}>
          Ir a Configuración → Canales
        </Link>
      </div>
    </div>
  );
}
