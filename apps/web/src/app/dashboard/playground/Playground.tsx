"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./playground.module.css";

type Provider = "whatsapp" | "instagram" | "messenger";

type Conversation = {
  id: string;
  provider: Provider;
  contact_name: string | null;
  stage: string;
  created_at: string;
};

type Message = {
  id: string;
  role: "contact" | "assistant" | "agent" | "system";
  content: string;
};

type Bubble = { content: string; delayMs: number };

const PROVIDER_LABEL: Record<Provider, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ventana de agrupado: como en WhatsApp, tras el último mensaje del lead esperamos
// este tiempo antes de generar UNA sola respuesta con todo el contexto.
const DEBOUNCE_MS = 2500;

export default function Playground() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("whatsapp");
  const [contactName, setContactName] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  // Timer del debounce y "token" de generación: cada mensaje nuevo lo incrementa,
  // invalidando cualquier respuesta en curso (para no mezclar tandas).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>("/api/playground/conversations");
      setConversations(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function cancelPending() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    genRef.current++; // invalida cualquier generación en curso
    setTyping(false);
  }

  // Limpia timers al desmontar.
  useEffect(() => () => cancelPending(), []);

  async function selectConversation(id: string) {
    cancelPending();
    setSelected(id);
    setMessages([]);
    setError(null);
    try {
      const { messages: msgs } = await apiFetch<{ messages: Message[] }>(
        `/api/playground/conversations/${id}`,
      );
      setMessages(msgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function createConversation() {
    setError(null);
    try {
      const conv = await apiFetch<Conversation>("/api/playground/conversations", {
        method: "POST",
        body: JSON.stringify({ provider, contact_name: contactName }),
      });
      setContactName("");
      setConversations((prev) => [conv, ...prev]);
      setSelected(conv.id);
      setMessages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function deleteConversation(id: string) {
    try {
      await apiFetch(`/api/playground/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (selected === id) {
        setSelected(null);
        setMessages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  // Enviar un mensaje del lead: se muestra al instante, se GUARDA (sin respuesta)
  // y se (re)programa la generación. Puedes enviar varios seguidos: se agrupan.
  function send() {
    const text = input.trim();
    if (!text || !selected) return;
    setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}-${Math.random()}`, role: "contact", content: text },
    ]);

    // Un mensaje nuevo invalida la generación en curso y reinicia el debounce.
    cancelPending();
    const convId = selected;
    void apiFetch(`/api/playground/conversations/${convId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text, reply: false }),
    }).catch((e) => setError(e instanceof Error ? e.message : "Error al enviar"));

    debounceRef.current = setTimeout(() => void runGenerate(convId), DEBOUNCE_MS);
  }

  async function runGenerate(convId: string) {
    const myGen = ++genRef.current;
    setTyping(true);
    setError(null);
    try {
      const { reply } = await apiFetch<{ reply: Bubble[] }>(
        `/api/playground/conversations/${convId}/generate`,
        { method: "POST" },
      );
      if (myGen !== genRef.current) return; // llegó un mensaje nuevo: se descarta
      setTyping(false);
      for (const b of reply) {
        if (myGen !== genRef.current) return;
        setTyping(true);
        await sleep(Math.min(b.delayMs, 2200));
        setTyping(false);
        if (myGen !== genRef.current) return;
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}-${Math.random()}`, role: "assistant", content: b.content },
        ]);
      }
    } catch (e) {
      if (myGen === genRef.current) {
        setError(e instanceof Error ? e.message : "Error al responder");
      }
    } finally {
      if (myGen === genRef.current) setTyping(false);
    }
  }

  const current = conversations.find((c) => c.id === selected);

  return (
    <div className={styles.wrap}>
      <aside className={styles.list}>
        <div className={styles.newBox}>
          <select
            className={styles.select}
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
          </select>
          <input
            className={styles.nameInput}
            placeholder="Nombre del lead (opcional)"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
          <button className={styles.newBtn} onClick={createConversation}>
            + Nueva conversación
          </button>
        </div>

        <div className={styles.convs}>
          {conversations.length === 0 && (
            <p className={styles.empty}>Sin conversaciones de prueba.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`${styles.conv} ${selected === c.id ? styles.convActive : ""}`}
              onClick={() => selectConversation(c.id)}
            >
              <div className={styles.convInfo}>
                <span className={styles.convName}>{c.contact_name ?? "Lead"}</span>
                <span className={styles.convMeta}>{PROVIDER_LABEL[c.provider]}</span>
              </div>
              <button
                className={styles.del}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
                aria-label="Eliminar"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className={styles.chat}>
        {!current ? (
          <div className={styles.placeholder}>
            <p>Crea o elige una conversación para empezar a probar.</p>
          </div>
        ) : (
          <>
            <header className={styles.chatHead}>
              <span className={styles.chatName}>{current.contact_name ?? "Lead"}</span>
              <span className={styles.chatProvider}>{PROVIDER_LABEL[current.provider]}</span>
            </header>

            <div className={styles.messages}>
              {messages
                .filter((m) => m.role !== "system")
                .map((m) => (
                  <div
                    key={m.id}
                    className={`${styles.bubble} ${
                      m.role === "contact" ? styles.bubbleContact : styles.bubbleAi
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
              {typing && (
                <div className={`${styles.bubble} ${styles.bubbleAi} ${styles.typing}`}>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {error && <div className={styles.errorBar}>{error}</div>}

            <div className={styles.inputBar}>
              <input
                className={styles.msgInput}
                placeholder="Escribe como si fueras el lead… (puedes enviar varios seguidos)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className={styles.sendBtn} onClick={send}>
                Enviar
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
