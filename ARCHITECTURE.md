# Arquitectura del Proyecto — Bot Setter SaaS

> Documento vivo. Es la referencia única del proyecto: stack, modelo de datos,
> seguridad, integraciones, despliegue en AWS y roadmap. Se actualiza a medida
> que avanzamos. Está escrito para que lo entiendas mientras aprendes, no solo
> para "técnicos".

---

## 1. Qué es el producto

Un **SaaS multi-tenant** (varios clientes, datos aislados entre sí) que ofrece un
**bot "setter" con IA** para gente que lanza anuncios en Meta. El flujo del lead:

```
Anuncio (Meta) → el lead manda un DM (WhatsApp / Instagram / Messenger)
   → el bot contesta como un humano
   → conversa y CUALIFICA
   → si cualifica, AGENDA una llamada con un closer
   → analítica, seguimiento (follow-ups) y cierre
```

Es un clon mejorado de SkaleX/Zapp, construido por fases.

### Módulos (visión completa del producto)

- **Inbox unificado (Chats):** conversaciones de los 3 canales en un solo lugar,
  asignación a closers, etiquetas, notas, programar mensajes, panel del contacto
  (datos, fase del funnel, control de IA: pausar / continuar / forzar).
- **Mi Setter:** el "cerebro" de la IA — identidad, rol, promesa/producto, fases
  del embudo, reglas y límites, tono, prueba social, precio, FAQ, casos
  especiales, frecuencia de follow-up.
- **Probar IA:** sandbox para chatear con el bot antes de activarlo.
- **Etiquetas + automatizaciones:** reglas "si pasa X → haz Y" (mover de carpeta,
  pausar/reactivar IA, etc.).
- **Equipo y roles:** Administrador, Closer y el usuario sistema "Closer IA".
- **Estadísticas:** chats por carpeta, conversión, tiempos de respuesta,
  desglose por etiqueta y por closer.
- **Exportar:** conversaciones en TXT/JSON/CSV/Excel filtradas.
- **WhatsApp templates + envíos masivos** (capa oficial Meta, fase posterior).
- **Conectar (integraciones):** canales (Unipile), calendarios, ventas.
- **Ajustes IA:** on/off global, delay aleatorio antes de responder, velocidad de
  escritura, horario de respuesta por timezone, "no responder a cuentas que
  sigues", contactos silenciados.
- **Facturación:** planes, límites y consumo (Stripe).

---

## 2. Decisiones tomadas (y por qué)

| Tema | Decisión | Motivo |
|---|---|---|
| Canales | **Unipile session-based** primero; Meta oficial como capa opcional futura | Prioridad "100% humano". La sesión real no usa plantillas ni etiqueta "Business" |
| Primer canal | **WhatsApp** | Mayor volumen de setters |
| Base de datos | **Supabase (Postgres + RLS + Auth)** | RLS = aislamiento multi-tenant seguro por defecto; rápido; migrable a AWS (mismo motor) |
| Despliegue | **AWS** (ECS Fargate + ALB + ElastiCache Redis) | Contenedores gestionados, sin servidores a mano, escala bien |
| IA | **OpenRouter**, modelo configurable | Cambiar de modelo sin tocar código; elegir el mejor por idioma/coste |
| "Humanización" | Por **ingeniería** (burbujas, delays, voz), no solo el modelo | Es lo que hace que "no se note" |
| Calendario | Motor de slots **propio** + Unipile (leer ocupados / crear evento / webhooks). **Google + Outlook** | Unipile no genera huecos; el control de disponibilidad lo queremos nosotros |
| Idiomas | **Multi-idioma** (bot responde en el idioma del lead); UI ES con i18n preparado | Requisito del negocio |
| Cobro | **Planes fijos** (límite de cuentas conectadas + conversaciones IA/mes) + closers add-on, vía **Stripe** | El precio sigue a tus costes reales (Unipile + tokens) |
| Alcance | Clon completo, **por fases** | Manejable y aprendible |

---

## 3. Stack técnico

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend: Next.js + TS + sistema de diseño "Eneryia" (CSS Modules)│
│  (landing pública + panel del SaaS, i18n con next-intl)            │
└───────────────┬──────────────────────────────────────────────────┘
                │  HTTPS / WebSocket (realtime inbox)
┌───────────────▼──────────────────────────────────────────────────┐
│  API: NestJS (Node + TypeScript)                                   │
│   - REST + WebSocket Gateway                                       │
│   - Webhooks (Unipile mensajes + calendario)                      │
│   - Auth (Supabase) + RBAC                                         │
└───────┬─────────────────────────────────────┬────────────────────┘
        │ encola trabajos                       │ lee/escribe
┌───────▼─────────────────┐         ┌───────────▼────────────────────┐
│  Workers (BullMQ)        │         │  Supabase (Postgres + RLS)      │
│   - procesar mensaje IA  │         │   + pgvector (RAG)              │
│   - delays + "escribiendo"│        │   + Storage (audios/adjuntos)  │
│   - follow-ups 7d/14d    │         └────────────────────────────────┘
│   - envíos masivos       │
│   - cálculo de slots     │         ┌────────────────────────────────┐
└───────┬──────────────────┘         │  Redis (ElastiCache): colas    │
        │ llama                       └────────────────────────────────┘
┌───────▼──────────────────┐
│  Servicios externos:      │
│   - Unipile (canales+cal) │
│   - OpenRouter (LLM)      │
│   - Stripe (billing)      │
│   - TTS (notas de voz)    │
└───────────────────────────┘
```

**Por qué TypeScript de punta a punta:** un solo lenguaje, tipos compartidos
front/back, fácil de mantener y contratar.

**Por qué colas (Redis + BullMQ) son obligatorias:** el bot es asíncrono. Un
mensaje entrante dispara: esperar un delay aleatorio → mostrar "escribiendo…" →
responder en varias burbujas. Además hay follow-ups a días vista, envíos
masivos y reintentos. Nada de esto puede vivir en una petición HTTP normal.

---

## 4. Modelo de datos (Postgres / Supabase)

Principio rector: **toda fila pertenece a una `organization` y está protegida con
Row Level Security (RLS)**. Un cliente nunca puede leer datos de otro, aunque
haya un bug en el código de la aplicación.

### Tablas núcleo

```sql
-- Tenant
organizations(id, name, slug, plan, created_at, settings jsonb)

-- Usuarios y pertenencia (un usuario puede estar en varias orgs)
users(id, email, full_name, ...)                  -- gestionado por Supabase Auth
memberships(id, organization_id, user_id, role)   -- role: 'admin' | 'closer'

-- Cuentas de canal conectadas vía Unipile
channel_accounts(
  id, organization_id,
  provider,            -- 'whatsapp' | 'instagram' | 'messenger'
  unipile_account_id,  -- id de la cuenta en Unipile
  display_name, status,-- 'operational' | 'auth_required' | 'paused'
  credentials_enc,     -- tokens CIFRADOS (nunca en texto plano)
  created_at
)

-- Leads / personas que escriben
contacts(
  id, organization_id, channel_account_id,
  external_id,         -- id del lead en el proveedor
  name, handle, phone, email,
  enrichment jsonb,    -- datos extra (sigue/seguido, etc.)
  language,            -- idioma detectado (multi-idioma)
  created_at
)

-- Hilo de conversación
conversations(
  id, organization_id, contact_id, channel_account_id,
  folder,              -- 'chats' | 'calendario' | 'llamada_agendada' | 'comprados'
  funnel_stage,        -- 'F1', 'F2', ...
  assigned_to,         -- user_id (closer) o NULL
  ai_status,           -- 'active' | 'paused'
  last_message_at, created_at
)

-- Mensajes
messages(
  id, organization_id, conversation_id,
  direction,           -- 'inbound' | 'outbound'
  sender,              -- 'lead' | 'ai' | 'human'
  type,                -- 'text' | 'voice' | 'image' | 'file'
  content, media_url,
  unipile_message_id,
  status,              -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
  created_at
)

-- Etiquetas y automatizaciones
labels(id, organization_id, name, color)
automations(
  id, organization_id, label_id,
  trigger jsonb,       -- "cuándo se activa" (ej. la IA escribe X)
  action jsonb         -- "qué hace" (mover carpeta / pausar IA / ...)
)

-- El cerebro de la IA
setter_configs(
  id, organization_id,
  identity, role, promise, product,
  funnel_stages jsonb, rules jsonb, tone jsonb,
  social_proof, price, faq jsonb, special_cases jsonb,
  followup_schedule jsonb,   -- ej. [23h, 7d, 14d]
  reply_delay_min, reply_delay_max, typing_speed,
  active_hours jsonb, timezone,
  model,                     -- modelo de OpenRouter elegido
  updated_at
)

-- Base de conocimiento para RAG
knowledge_chunks(
  id, organization_id, source, content,
  embedding vector(1536)     -- pgvector
)

-- Calendario y agendamiento propio
calendars(
  id, organization_id, user_id,
  provider,                  -- 'google' | 'outlook'
  unipile_account_id, unipile_calendar_id,
  availability_rules jsonb,  -- horario, duración slot, buffers, máx/día, tz
  created_at
)
appointments(
  id, organization_id, conversation_id, calendar_id,
  contact_id, assigned_to,
  start_at, end_at, timezone,
  unipile_event_id, meet_url,
  status,                    -- 'scheduled' | 'cancelled' | 'completed'
  created_at
)

-- Seguridad y facturación
audit_logs(id, organization_id, actor_id, action, target, meta jsonb, created_at)
billing_subscriptions(id, organization_id, stripe_customer_id,
  stripe_subscription_id, plan, status, limits jsonb)
usage_counters(id, organization_id, period, ai_conversations, connected_accounts)
```

> Nota de escala: `messages` puede crecer mucho. Si llega el momento, se
> particiona por fecha. No es preocupación del MVP.

---

## 5. Seguridad (prioridad transversal)

1. **Aislamiento multi-tenant:** RLS en TODAS las tablas por `organization_id`.
   El backend usa el contexto del usuario; los workers usan service-role con
   filtrado explícito por organización.
2. **Cifrado:**
   - En tránsito: TLS en todo (ACM en AWS).
   - En reposo: cifrado del disco de la BD (Supabase/KMS).
   - A nivel de campo: tokens de Unipile y credenciales en `*_enc` con clave en
     AWS KMS. Nunca en texto plano, nunca en el repo.
3. **Secretos:** AWS Secrets Manager. El repo no contiene claves (solo
   `.env.example`).
4. **RBAC:** permisos por recurso según rol (admin / closer). El "Closer IA" es
   un actor del sistema, no un login humano.
5. **Webhooks firmados:** verificar la firma de Unipile (y de Meta en la capa
   oficial) para que nadie inyecte mensajes falsos. Responder 2xx rápido y
   procesar en cola.
6. **GDPR/RGPD:** las conversaciones tienen datos personales de leads →
   consentimiento, política de retención, borrado bajo petición, DPA con Unipile.
7. **Defensa en profundidad:** MFA, rate limiting, WAF (AWS WAF), audit logs,
   IAM de mínimo privilegio, escaneo de dependencias, backups automáticos.

---

## 6. Integración de canales (Unipile)

### Conexión
Cada cliente conecta su cuenta (WhatsApp primero) mediante la **hosted auth** de
Unipile (página white-label). Guardamos su `unipile_account_id` y tokens cifrados
en `channel_accounts`.

### Recibir mensajes (entrada)
```
Unipile webhook (message.received)
  → nuestro endpoint HTTPS (verifica firma, responde 2xx)
  → encola job
  → worker: guarda contact + message, emite realtime al inbox,
            decide si la IA debe responder (ai_status, horario, silenciados)
```

### Responder como humano (salida)
```
worker IA:
  1. arma contexto: setter_config (prompt) + historial + RAG (knowledge_chunks)
  2. llama a OpenRouter → genera respuesta
  3. divide en 2-3 burbujas cortas
  4. espera delay aleatorio (reply_delay_min..max)
  5. muestra "escribiendo…" proporcional al largo (typing_speed)
  6. envía por Unipile (texto o NOTA DE VOZ vía TTS)
  7. guarda message(s) outbound + dispara automatizaciones/etiquetas
```

### Anti-baneo (porque usamos sesión real)
- Delays aleatorios + simulación de escritura.
- Horario de actividad (no responder de madrugada).
- Límites de volumen y "warmup" de cuentas nuevas.
- No responder a cuentas que el usuario sigue (IG).
- Tráfico mayormente **entrante** (leads de anuncios), que es de bajo riesgo.

### Capa oficial Meta (futura, opcional)
Para clientes que quieran cero riesgo: WhatsApp Cloud API con plantillas
aprobadas para follow-ups proactivos. Misma capa de mensajería, distinto
"transport".

---

## 7. Motor de IA "100% humano"

El realismo es **80% ingeniería**, no solo el modelo:

- **Burbujas múltiples:** responder en 2-3 mensajes cortos, no un párrafo.
- **Delays de lectura + "escribiendo…"** proporcional al largo.
- **Tono configurable** por cliente (casual, emojis, modismos regionales).
- **Notas de voz (TTS):** el mayor salto de "humanidad" (Unipile las soporta).
- **Caso "¿eres un bot?":** el setter mantiene su identidad humana.
- **Multi-idioma:** detecta el idioma del lead y responde en él.
- **Memoria:** todo el historial + base de conocimiento del negocio (RAG).
- **Modelo configurable** vía OpenRouter; A/B testing por calidad de español.

---

## 8. Agendamiento (sistema propio + Unipile)

Unipile da: listar calendarios, leer calendario, **crear evento** (con
Google Meet/Zoom/Teams + asistentes) y **webhooks** (creado/actualizado/borrado).
NO genera huecos libres → eso lo construimos nosotros:

```
1. El closer conecta Google/Outlook (Unipile hosted auth).
2. Define availability_rules: horario, duración de slot, buffers,
   máx llamadas/día, timezone, round-robin entre closers.
3. Leemos eventos ocupados → calculamos huecos libres.
4. El bot ofrece huecos en el chat ("¿te va mañana 16:00 o 18:00?").
5. Al elegir → creamos el evento vía Unipile (Meet + email lead + closer).
6. Los webhooks de calendario mantienen todo sincronizado (cancelar/mover).
```

Referencias Unipile:
- Webhooks calendario: https://developer.unipile.com/docs/calendar-webhook
- Crear evento: https://developer.unipile.com/reference/calendarscontroller_createcalendarevent
- Listar calendarios: https://developer.unipile.com/reference/calendarscontroller_listcalendars

---

## 9. Despliegue en AWS (explicado simple)

Piensa en AWS como piezas de Lego. Cada una hace una cosa:

| Pieza AWS | Para qué | Analogía |
|---|---|---|
| **ECS Fargate** | Corre los contenedores Docker (API y workers) sin gestionar servidores | "Enchufas tu app y corre sola" |
| **ALB** (load balancer) | Reparte tráfico y recibe webhooks por HTTPS | "El recepcionista que dirige a cada visita" |
| **ElastiCache (Redis)** | Las colas de BullMQ | "La lista de tareas pendientes" |
| **Supabase / RDS** | La base de datos | "El archivador" |
| **CloudFront + S3** (o Vercel) | Sirve el frontend | "La vitrina de la tienda" |
| **Secrets Manager + KMS** | Secretos y cifrado | "La caja fuerte" |
| **Route53** | DNS (tu dominio) | "La guía telefónica" |
| **ACM** | Certificados SSL gratis | "El sello de seguridad HTTPS" |
| **CloudWatch** | Logs y alertas | "Las cámaras de seguridad" |
| **AWS WAF** | Firewall de aplicación | "El portero que filtra ataques" |

Cuando lleguemos a desplegar, montamos cada pieza paso a paso. No necesitas
saber AWS de antemano.

---

## 10. Roadmap por fases

> Construimos el clon completo, pero en orden manejable. Cada fase es entregable
> y aprendible.

1. **Fundación**
   - Monorepo (Next.js + NestJS), Supabase con RLS, modelo de datos,
     auth + roles (admin/closer), despliegue base en AWS.
2. **WhatsApp + Inbox unificado**
   - Hosted auth Unipile, webhooks → cola → guardar → realtime al front.
3. **Setter IA**
   - Mi Setter (config) → prompt → respuesta humana (burbujas/delays/voz).
4. **Etiquetas + automatizaciones**
   - Reglas "si X → Y", pausar/reactivar IA, carpetas.
5. **Agendamiento**
   - Motor de slots + Unipile calendar (Google + Outlook).
6. **Estadísticas + Exportar**
7. **Instagram + Messenger**
   - Mismo motor, nuevos transports.
8. **Facturación (Stripe) + panel admin + endurecer seguridad**

---

## 11. Estado actual y siguiente paso

- [x] Análisis, decisiones y arquitectura definidos (este documento).
- [x] Toolchain instalada (Node 22, pnpm 11).
- [x] Monorepo montado: `apps/web` (Next.js 16), `apps/api` (NestJS 11),
      `packages/shared` (tipos). Ambos compilan y la API responde en
      `/api/health`.
- [ ] **Siguiente:** conectar Supabase (esquema + RLS + auth) y dejar el login
      con roles funcionando.

### Cómo levantar el proyecto en local

```bash
# Desde la raíz del repo
pnpm install          # instala todo el workspace
pnpm dev              # levanta web (3000) y api (3001) a la vez
# o por separado:
pnpm dev:web          # http://localhost:3000
pnpm dev:api          # http://localhost:3001/api/health
```

### Cuentas pendientes de crear (te guío)
- [x] Unipile
- [x] OpenRouter
- [ ] AWS
- [ ] Supabase
- [ ] Dominio
- [ ] Stripe (fase posterior)
