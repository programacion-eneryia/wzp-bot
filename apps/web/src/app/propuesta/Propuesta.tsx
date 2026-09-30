"use client";

/**
 * BOCETO de propuesta UX (v2). Página paralela y 100% estática: no llama a la
 * API ni toca el dashboard real. Misma línea gráfica del producto (negro +
 * amarillo de marca) y marca ENERYETICO. URL: /propuesta
 */

import { useState } from "react";
import styles from "./propuesta.module.css";

type ViewId =
  | "inicio"
  | "conversaciones"
  | "contactos"
  | "agenda"
  | "resultados"
  | "asistente"
  | "automatizaciones"
  | "configuracion";

const NAV: Array<{
  group: string;
  items: Array<{ id: ViewId; label: string; icon: string; badge?: string }>;
}> = [
  {
    group: "Tu día a día",
    items: [
      { id: "inicio", label: "Inicio", icon: "home" },
      { id: "conversaciones", label: "Conversaciones", icon: "chat", badge: "4" },
      { id: "contactos", label: "Contactos", icon: "users" },
      { id: "agenda", label: "Agenda", icon: "calendar", badge: "3" },
      { id: "resultados", label: "Resultados", icon: "chart" },
    ],
  },
  {
    group: "Tu asistente",
    items: [
      { id: "asistente", label: "Eneryetico", icon: "bot" },
      { id: "automatizaciones", label: "Automatizaciones", icon: "zap" },
    ],
  },
  {
    group: "Configuración",
    items: [{ id: "configuracion", label: "Ajustes y conexiones", icon: "settings" }],
  },
];

function Icon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H4l1.5-3A8 8 0 1 1 21 12Z" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.8 15.2c2 .7 3.3 2.3 3.7 4.8" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 20V4" />
          <path d="M4 20h16" />
          <path d="M8.5 16v-5M13 16V8M17.5 16v-8" />
        </svg>
      );
    case "bot":
      return (
        <svg {...common}>
          <rect x="4.5" y="7.5" width="15" height="11" rx="3" />
          <path d="M12 4.5v3M9.5 12.5h.01M14.5 12.5h.01M9 15.5h6" />
        </svg>
      );
    case "zap":
      return (
        <svg {...common}>
          <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2Z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m4.5 12.5 5 5 10-11" />
        </svg>
      );
    default:
      return null;
  }
}

/* ----------------------------- vistas del mock ---------------------------- */

function VistaInicio() {
  return (
    <>
      <div className={styles.viewHead}>
        <div>
          <span className={styles.eyebrow}>VIERNES 7 DE AGOSTO</span>
          <h1 className={styles.viewTitle}>
            Hola, Alejandro <span className={styles.serif}>esto es lo que importa hoy</span>
          </h1>
        </div>
        <button className={styles.primaryBtn}>Añadir lead</button>
      </div>

      {/* 1. Estado del asistente: SIEMPRE lo primero. El usuario nunca debe
          preguntarse "¿está funcionando?". */}
      <div className={styles.assistantCard}>
        <div className={styles.assistantLeft}>
          <span className={styles.pulse} />
          <div>
            <strong>Eneryetico está activo</strong>
            <p className={styles.mutedSm}>
              Lleva 6 conversaciones ahora mismo · 41 mensajes y 3 llamadas agendadas hoy ·
              última respuesta hace 4 min
            </p>
          </div>
        </div>
        <div className={styles.assistantActions}>
          <button className={styles.ghostBtn}>Ver lo que dice</button>
          <button className={styles.softBtn}>Pausar</button>
        </div>
      </div>

      {/* 2. Puesta en marcha guiada: la mayor fuente de soporte es "lo conecté
          y no responde". El checklist lo hace autoexplicativo. */}
      <div className={styles.checklist}>
        <div className={styles.checklistHead}>
          <strong>Puesta en marcha</strong>
          <span className={styles.mutedSm}>3 de 4 pasos completados</span>
        </div>
        <div className={styles.checklistSteps}>
          <div className={`${styles.step} ${styles.stepDone}`}>
            <Icon name="check" /> WhatsApp conectado
          </div>
          <div className={`${styles.step} ${styles.stepDone}`}>
            <Icon name="check" /> Personalidad de Eneryetico
          </div>
          <div className={`${styles.step} ${styles.stepDone}`}>
            <Icon name="check" /> Leads entrando desde GHL
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>4</span> Crea el flow que activa a Eneryetico
            <button className={styles.stepBtn}>Crear ahora</button>
          </div>
        </div>
      </div>

      <div className={styles.kpis}>
        {[
          { n: "9", t: "Leads nuevos hoy", d: "+3 vs ayer" },
          { n: "4", t: "Chats que te necesitan", d: "el resto los lleva Eneryetico" },
          { n: "3", t: "Llamadas hoy", d: "próxima a las 16:30" },
          { n: "48", t: "Llamadas este mes", d: "de 89 leads · 54%" },
        ].map((k) => (
          <div key={k.t} className={styles.kpi}>
            <span className={styles.kpiNum}>{k.n}</span>
            <span className={styles.kpiTitle}>{k.t}</span>
            <span className={styles.kpiDetail}>{k.d}</span>
          </div>
        ))}
      </div>

      <div className={styles.cols}>
        {/* 3. Bandeja de atención: ordenada por urgencia, con la RAZÓN visible
            y la acción a un clic. Nada de buscar entre 89 filas. */}
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Te necesitan</h2>
            <span className={styles.countPill}>4</span>
          </div>
          {[
            { name: "Andrés Hernández", why: "Pidió hablar con una persona", when: "hace 12 min", cta: "Responder" },
            { name: "Rodo", why: "Llamada de hoy sin confirmar", when: "hace 1 h", cta: "Confirmar" },
            { name: "Wilfrido", why: "Eneryetico pausado desde ayer", when: "hace 1 día", cta: "Reactivar" },
            { name: "Leonardo Zamora", why: "2 días sin respuesta del lead", when: "hace 2 días", cta: "Reenganchar" },
          ].map((r) => (
            <div key={r.name} className={styles.attnRow}>
              <span className={styles.avatar}>{r.name.slice(0, 1)}</span>
              <div className={styles.attnBody}>
                <strong>{r.name}</strong>
                <span className={styles.mutedSm}>{r.why}</span>
              </div>
              <span className={styles.mutedXs}>{r.when}</span>
              <button className={styles.rowBtn}>{r.cta}</button>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Próximas llamadas</h2>
            <button className={styles.linkBtn}>Ver agenda</button>
          </div>
          {[
            { name: "DBS", phone: "+52 1 933 256 5162", when: "Hoy · 16:30" },
            { name: "Andrés Hernández", phone: "+52 1 206 415 3771", when: "Hoy · 18:00" },
            { name: "Rodo", phone: "+52 1 970 544 4229", when: "Mañana · 10:30" },
          ].map((c) => (
            <div key={c.name} className={styles.callRow}>
              <div className={styles.attnBody}>
                <strong>{c.name}</strong>
                <span className={styles.mutedSm}>{c.phone}</span>
              </div>
              <span className={styles.timePill}>{c.when}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function VistaConversaciones() {
  return (
    <>
      <div className={styles.viewHead}>
        <div>
          <span className={styles.eyebrow}>WHATSAPP · INSTAGRAM</span>
          <h1 className={styles.viewTitle}>Conversaciones</h1>
        </div>
      </div>

      {/* Triaje por PROPIETARIO del chat, no por metadatos técnicos. La primera
          pregunta del usuario siempre es "¿cuáles tengo que mirar yo?". */}
      <div className={styles.chips}>
        <button className={`${styles.chip} ${styles.chipOn}`}>Te necesitan · 4</button>
        <button className={styles.chip}>Las lleva Eneryetico · 6</button>
        <button className={styles.chip}>Las llevas tú · 2</button>
        <button className={styles.chip}>Todas · 12</button>
      </div>

      <section className={styles.panel}>
        {[
          { name: "Andrés Hernández", last: "vale y cómo funciona lo del pago", when: "12:40", state: "Te necesita", tone: "warn" },
          { name: "DBS", last: "perfecto nos vemos en la llamada", when: "11:52", state: "Llamada agendada", tone: "ok" },
          { name: "Rodo", last: "déjame pensarlo y te digo", when: "09:15", state: "Eneryetico", tone: "accent" },
          { name: "Wilfrido", last: "hola, vi el anuncio", when: "Ayer", state: "La llevas tú", tone: "muted" },
        ].map((c) => (
          <div key={c.name} className={styles.convRow}>
            <span className={styles.avatar}>{c.name.slice(0, 1)}</span>
            <div className={styles.attnBody}>
              <strong>{c.name}</strong>
              <span className={styles.mutedSm}>{c.last}</span>
            </div>
            <span className={`${styles.statePill} ${styles[`tone_${c.tone}`]}`}>{c.state}</span>
            <span className={styles.mutedXs}>{c.when}</span>
          </div>
        ))}
      </section>

      <div className={styles.uxNote}>
        <strong>Dentro del chat:</strong> si escribes tú (aquí, desde el móvil o desde GHL),
        Eneryetico se pausa solo y el chat pasa a “La llevas tú” — con un botón único y
        visible: <span className={styles.fakeBtn}>Devolver a Eneryetico</span>. Hoy ese estado
        es un toggle pequeño que nadie entiende.
      </div>
    </>
  );
}

function VistaContactos() {
  return (
    <>
      <div className={styles.viewHead}>
        <div>
          <span className={styles.eyebrow}>TU EMBUDO</span>
          <h1 className={styles.viewTitle}>Contactos</h1>
        </div>
        <button className={styles.primaryBtn}>Añadir contacto</button>
      </div>

      {/* El embudo es navegación, no decoración: clic en una etapa = filtro. */}
      <div className={styles.funnel}>
        {[
          { t: "Nuevos", n: 41 },
          { t: "Hablando", n: 23 },
          { t: "Cualificados", n: 9 },
          { t: "Llamada agendada", n: 48 },
          { t: "Clientes", n: 5 },
        ].map((s) => (
          <button key={s.t} className={styles.funnelStep}>
            <span className={styles.funnelNum}>{s.n}</span>
            <span className={styles.mutedSm}>{s.t}</span>
          </button>
        ))}
      </div>

      <section className={styles.panel}>
        {[
          { name: "DBS", phone: "+52 1 933 256 5162", from: "Anuncio de Instagram", stage: "Llamada agendada", tone: "ok" },
          { name: "Andrés Hernández", phone: "+52 1 206 415 3771", from: "Mensaje directo", stage: "Llamada agendada", tone: "ok" },
          { name: "Wilfrido", phone: "+52 1 743 241 8297", from: "Formulario GHL", stage: "Nuevo", tone: "accent" },
          { name: "Leonardo Zamora", phone: "+52 1 209 162 1433", from: "Mensaje directo", stage: "Hablando", tone: "muted" },
        ].map((l) => (
          <div key={l.name} className={styles.convRow}>
            <span className={styles.avatar}>{l.name.slice(0, 1)}</span>
            <div className={styles.attnBody}>
              <strong>{l.name}</strong>
              <span className={styles.mutedSm}>
                {l.phone} · {l.from}
              </span>
            </div>
            <span className={`${styles.statePill} ${styles[`tone_${l.tone}`]}`}>{l.stage}</span>
            <button className={styles.rowBtn}>Abrir chat</button>
          </div>
        ))}
      </section>

      <div className={styles.uxNote}>
        <strong>Lenguaje humano siempre:</strong> nunca ids técnicos tipo “193256…@lid” como
        texto principal (si no hay nombre, se muestra el teléfono), fuentes legibles
        (“Anuncio de Instagram” en vez de “ctwa”) y la acción principal de cada fila es{" "}
        <em>Abrir chat</em>, que es lo que el usuario hace el 90% de las veces.
      </div>
    </>
  );
}

function VistaGenerica({ title, sub, note }: { title: string; sub: string; note?: string }) {
  return (
    <>
      <div className={styles.viewHead}>
        <div>
          <span className={styles.eyebrow}>BOCETO</span>
          <h1 className={styles.viewTitle}>{title}</h1>
          <p className={styles.viewSub}>{sub}</p>
        </div>
      </div>
      <section className={`${styles.panel} ${styles.placeholder}`}>
        <p className={styles.mutedSm}>
          {note ??
            "Mantiene el contenido actual con el nuevo nombre y los mismos principios: lenguaje humano, la acción principal a un clic y el estado del asistente siempre visible."}
        </p>
      </section>
    </>
  );
}

/* ------------------------------ análisis UX ------------------------------- */

const JOURNEY = [
  { t: "Entra un lead", d: "Del anuncio, formulario o chat directo. Aparece en Contactos como “Nuevo”." },
  { t: "Se activa Eneryetico", d: "Tu automatización decide cuándo: primer mensaje y pase a la IA." },
  { t: "Eneryetico cualifica", d: "Conversa, responde dudas y propone la llamada. Tú solo miras “Te necesitan”." },
  { t: "Llamada agendada", d: "Eneryetico se pausa solo, la cita entra en Agenda con nombre y teléfono. Cierras tú." },
];

const RENAMES: Array<{ before: string; after: string; why: string }> = [
  { before: "CRM", after: "Contactos", why: "“CRM” es jerga de software. Aquí se busca a personas por su nombre." },
  { before: "Chats", after: "Conversaciones", why: "El mismo lenguaje que WhatsApp; menos técnico." },
  { before: "Workflows", after: "Automatizaciones", why: "El anglicismo no explica nada; “Automatizaciones” sí." },
  { before: "Mi Setter + Probar IA", after: "Eneryetico", why: "El asistente tiene nombre propio y UN solo sitio: personalidad, reglas y una pestaña “Probar”." },
  { before: "Calendarios", after: "Agenda", why: "El usuario busca “mis llamadas”, no gestionar calendarios." },
  { before: "Estadísticas", after: "Resultados", why: "Orientado a negocio: qué está consiguiendo Eneryetico." },
  { before: "Canales + Integraciones + Ajustes", after: "Ajustes y conexiones", why: "Todo lo que se configura una vez, en un solo sitio al final del menú." },
  { before: "Etiquetas (menú propio)", after: "Dentro de Contactos", why: "Se usan filtrando contactos; no merecen primer nivel." },
  { before: "Equipo “pronto”", after: "Oculto hasta que exista", why: "Un menú con promesas resta confianza." },
];

const PRINCIPIOS: Array<{ t: string; d: string }> = [
  {
    t: "La primera pregunta del usuario manda: “¿qué tengo que hacer yo?”",
    d: "Todo el rediseño gira alrededor de la bandeja “Te necesitan”: chats donde la IA pidió ayuda, llamadas sin confirmar, leads fríos. Está en el Inicio, como primer filtro de Conversaciones y como contador en el menú. Hoy esa información no existe: hay que abrir chat por chat.",
  },
  {
    t: "El estado de Eneryetico, siempre visible y en lenguaje claro",
    d: "Con el bot pausado por defecto y las pausas automáticas (respondes tú, se agenda llamada, lo pide GHL), el usuario necesita saber en todo momento quién lleva cada chat. Propuesta: tarjeta de estado en Inicio, pill “Eneryetico / La llevas tú / Te necesita” en cada fila y un solo botón “Devolver a Eneryetico”.",
  },
  {
    t: "Puesta en marcha guiada, no un manual",
    d: "Checklist de 4 pasos en el Inicio (conectar WhatsApp, personalidad, entrada de leads, flow de activación). Crítico ahora: si el cliente no crea el flow que activa a Eneryetico, el bot no responde y parece roto. El checklist lo hace imposible de olvidar.",
  },
  {
    t: "Menú por frecuencia de uso, en dos alturas",
    d: "Arriba lo diario (Inicio, Conversaciones, Contactos, Agenda, Resultados); abajo lo que se toca una vez al mes (Eneryetico, Automatizaciones, Ajustes). Máximo 8 entradas, con iconos y contadores. Hoy hay 12 entradas planas, “Probar IA” entre CRM y Calendarios, y un “Equipo (pronto)”.",
  },
  {
    t: "Misma línea gráfica, mejor jerarquía",
    d: "Se mantienen el negro profundo, el amarillo de marca, la serifa italic y los tags monospace. Lo que cambia es la jerarquía: menos texto por pantalla, una sola acción primaria (amarilla) por vista, estados con color semántico y el resto en grises. El amarillo se reserva para “esto es lo importante”.",
  },
  {
    t: "Prevención de errores y feedback",
    d: "Acciones con consecuencias (pausar a Eneryetico, borrar una automatización, rotar el token) piden confirmación explicando el efecto. Toda acción responde con feedback visible (“Eneryetico pausado en este chat”). Los estados vacíos explican el siguiente paso en vez de quedar en blanco.",
  },
];

/* --------------------------------- página --------------------------------- */

export default function Propuesta() {
  const [view, setView] = useState<ViewId>("inicio");

  return (
    <div className={styles.page}>
      <div className={styles.topBanner}>
        <div>
          <strong>Propuesta UX v2</strong>
          <span>
            {" "}
            — boceto paralelo y estático con la línea gráfica actual. El dashboard real no
            cambia hasta que lo apruebes.
          </span>
        </div>
        <a className={styles.bannerLink} href="/dashboard">
          Volver al dashboard actual
        </a>
      </div>

      <header className={styles.intro}>
        <span className="tag-mono">PROPUESTA · EXPERIENCIA DE USUARIO</span>
        <h1 className={styles.introTitle}>
          Un panel que responde <span className={styles.serif}>“¿qué tengo que hacer hoy?”</span>
        </h1>
        <p className={styles.introText}>
          Misma identidad visual (negro + amarillo Eneryia), pero la experiencia se reordena
          alrededor de tres ideas: saber siempre qué chats te necesitan, saber siempre qué está
          haciendo Eneryetico, y que nadie se pierda al empezar. Haz clic en el menú del boceto
          para recorrer las vistas.
        </p>
      </header>

      {/* ------------------------------ mock ------------------------------ */}
      <div className={styles.mockFrame}>
        <div className={styles.mockBar}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.mockUrl}>app.eneryetico.com</span>
        </div>

        <div className={styles.mock}>
          <aside className={styles.sidebar}>
            <div className={styles.brand}>
              <span className={styles.brandMark}>E</span>
              <div className={styles.brandText}>
                <strong>ENERYETICO</strong>
                <span>tu setter con IA</span>
              </div>
            </div>

            <div className={styles.search}>Buscar contacto o chat…</div>

            <nav className={styles.nav}>
              {NAV.map((g) => (
                <div key={g.group} className={styles.navGroup}>
                  <span className={styles.navLabel}>{g.group}</span>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      className={`${styles.navItem} ${view === it.id ? styles.navItemOn : ""}`}
                      onClick={() => setView(it.id)}
                    >
                      <Icon name={it.icon} />
                      <span>{it.label}</span>
                      {it.badge && <span className={styles.navBadge}>{it.badge}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className={styles.userBox}>
              <span className={styles.avatar}>A</span>
              <div className={styles.userMeta}>
                <strong>Alejandro</strong>
                <span>aafirma · Admin</span>
              </div>
            </div>
          </aside>

          <main className={styles.content}>
            {view === "inicio" && <VistaInicio />}
            {view === "conversaciones" && <VistaConversaciones />}
            {view === "contactos" && <VistaContactos />}
            {view === "agenda" && (
              <VistaGenerica
                title="Agenda"
                sub="Tus llamadas con nombre y teléfono de cada persona"
                note="Cada cita muestra quién es, su teléfono, de qué campaña vino y un acceso directo al chat. Al agendarse, Eneryetico se pausa solo en ese chat."
              />
            )}
            {view === "resultados" && (
              <VistaGenerica
                title="Resultados"
                sub="Qué está consiguiendo Eneryetico"
                note="Tres números primero: leads atendidos, llamadas agendadas y % de conversión. Después el detalle por campaña y por semana. Nada de métricas de vanidad."
              />
            )}
            {view === "asistente" && (
              <VistaGenerica
                title="Eneryetico"
                sub="Personalidad, reglas, horario y una pestaña para probarlo"
                note="Une “Mi Setter” y “Probar IA” en un solo sitio con pestañas: Personalidad · Reglas · Horario · Probar. Configuras y pruebas sin cambiar de página."
              />
            )}
            {view === "automatizaciones" && (
              <VistaGenerica
                title="Automatizaciones"
                sub="Primer mensaje, seguimientos, activación de Eneryetico e integraciones"
                note="El editor visual actual, con plantillas para empezar (“Bienvenida + activar Eneryetico”, “Reenganche a los 2 días”) para no partir de un lienzo en blanco."
              />
            )}
            {view === "configuracion" && (
              <VistaGenerica
                title="Ajustes y conexiones"
                sub="WhatsApp, Instagram, GoHighLevel, ManyChat, equipo y plan"
                note="Canales + Integraciones + Ajustes en una sola sección con tarjetas por servicio y estado de conexión visible (conectado / con error / sin configurar)."
              />
            )}
          </main>
        </div>
      </div>

      {/* --------------------------- análisis UX -------------------------- */}
      <section className={styles.analysis}>
        <h2 className={styles.sectionTitle}>
          El recorrido del lead <span className={styles.serif}>en 4 pasos visibles</span>
        </h2>
        <p className={styles.sectionSub}>
          La interfaz cuenta siempre en qué punto del recorrido está cada persona. Ese es el
          modelo mental del usuario, no las tablas.
        </p>
        <div className={styles.journey}>
          {JOURNEY.map((j, i) => (
            <div key={j.t} className={styles.journeyStep}>
              <span className={styles.journeyNum}>{i + 1}</span>
              <strong>{j.t}</strong>
              <p>{j.d}</p>
            </div>
          ))}
        </div>

        <h2 className={styles.sectionTitle}>Qué cambia y por qué</h2>
        <div className={styles.principles}>
          {PRINCIPIOS.map((p, i) => (
            <article key={p.t} className={styles.principle}>
              <span className={styles.principleNum}>{String(i + 1).padStart(2, "0")}</span>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </article>
          ))}
        </div>

        <h2 className={styles.sectionTitle}>Nombres: antes y después</h2>
        <div className={styles.renameTable}>
          <div className={`${styles.renameRow} ${styles.renameHead}`}>
            <span>Hoy</span>
            <span>Propuesta</span>
            <span>Por qué</span>
          </div>
          {RENAMES.map((r) => (
            <div key={r.before} className={styles.renameRow}>
              <span className={styles.renameBefore}>{r.before}</span>
              <span className={styles.renameAfter}>{r.after}</span>
              <span className={styles.renameWhy}>{r.why}</span>
            </div>
          ))}
        </div>

        <div className={styles.footNote}>
          <strong>Siguiente paso:</strong> dime qué apruebas (nombres, orden del menú, el
          Inicio con “Te necesitan” y checklist, las pills de propietario del chat…) y lo
          aplico al dashboard real por fases, sin tocar ninguna funcionalidad.
        </div>
      </section>
    </div>
  );
}
