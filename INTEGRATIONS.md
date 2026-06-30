# Arquitectura de Integraciones y Conexiones

> Documento vivo. Describe cómo entra y sale cada mensaje del sistema, cómo se
> conectan Meta, GoHighLevel, ManyChat y Unipile, y el modelo de seguridad.
> Complementa a `ARCHITECTURE.md`.

---

## 1. Principio: 3 capas desacopladas

```
┌─ INGESTA (entrada) ───────────────────────────────────────────────┐
│ Unipile webhook · Meta Cloud API (CTWA) · Meta Lead Ads · GHL ·    │
│ ManyChat   →  cada adaptador normaliza a un evento interno          │
└───────────────────────────────┬───────────────────────────────────┘
                                ▼
              NÚCLEO (agnóstico al proveedor)
   conversación + modo (setter/support/ignored) + IA (debounce) + colas
                                ▼
┌─ TRANSPORTE (salida) ─────────────────────────────────────────────┐
│ TransportService.sendText / startChat → enruta por `transport`:     │
│   unipile · whatsapp_cloud · manychat · ghl                         │
└───────────────────────────────────────────────────────────────────┘
```

La IA decide **qué** decir; el `TransportService` decide **por dónde** se envía.
Cada conversación y canal lleva un campo **`transport`**. Añadir un canal nuevo
es añadir un `case` en `TransportService`, sin tocar el pipeline de IA.

Archivos clave:
- `apps/api/src/messaging/transport.service.ts` — router de salida.
- `apps/api/src/messaging/messaging.service.ts` — pipeline (debounce, watermark, proactivo).
- `apps/api/src/messaging/queues.ts` — colas BullMQ (`incoming`, `respond`, `outgoing`).

---

## 2. Mapa de integraciones por canal

| Canal / fuente | Entrada | Salida (transport) | Estado |
|---|---|---|---|
| WhatsApp conversacional | Unipile webhook | `unipile` (sesión) | ✅ |
| WhatsApp lead de anuncio (CTWA) | Meta Cloud API webhook (`referral`) | `whatsapp_cloud` (plantilla) → luego `unipile` | 🚧 Fase 2 |
| Meta Lead Ads (formularios) | GoHighLevel → `/api/leads/ghl` | `unipile`/`whatsapp_cloud` | ✅ (intake) |
| Instagram (comentarios/DM) | ManyChat → `/api/integrations/manychat/dynamic` | `manychat` | ✅ |
| Messenger | ManyChat / Unipile | `manychat`/`unipile` | ✅ |
| CRM / web / Zapier | `/api/leads/intake` | según canal | ✅ |

---

## 3. WhatsApp — modelo híbrido (decisión tomada)

- **Unipile (sesión real):** indistinguible de humano, sin plantillas. Para la
  **conversación** del día a día. Riesgo de baneo si se abusa en frío.
- **WhatsApp Cloud API (oficial):** para el **primer toque proactivo** (plantillas
  aprobadas dentro de la ventana de 24h) y para la **atribución**: el webhook trae
  `messages[0].referral` con `ctwa_clid`, `source_id`, `source_url`, `headline`
  cuando el lead viene de un anuncio click-to-WhatsApp.

Flujo del lead de anuncio:
```
Anuncio CTWA → lead escribe → Cloud API webhook (referral con ctwa_clid)
  → guardamos referral en la conversación (origen real del lead)
  → bot conversa y CUALIFICA
  → al cualificar: Conversions API (event "Lead" con ctwa_clid) → Meta optimiza
```

Docs: [CTWA / CAPI Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/).

---

## 4. GoHighLevel — Nivel 1 (decisión tomada)

GHL ya tiene conectados los anuncios de Meta. Usamos un **Workflow** con el
trigger *Facebook Lead Form Submitted* → acción *Webhook (saliente)* apuntando a:

```
POST https://TU-DOMINIO/api/leads/ghl?token=<intake_token>
```

`LeadsController.mapGhl` mapea los campos del contacto (`full_name`, `phone`,
`email`, `campaign`/`ad_id`…) a nuestro `IntakeInput` y dispara el primer mensaje
proactivo (con throttling). Sin App Review de Meta por nuestra parte.

> Nivel 2 (futuro): app de Marketplace (OAuth) o Private Integration Token +
> `POST /conversations/messages` (`Version: 2021-04-15`, scope
> `conversations/message.write`) para sincronizar conversaciones en GHL.

---

## 5. Instagram / Messenger — ManyChat (decisión tomada)

ManyChat (socio oficial de Meta) resuelve el cumplimiento de la política de IG
(ventana de 24h, private replies a comentarios, el tag HUMAN_AGENT **prohibido
para bots**). Nuestra IA es el cerebro vía **Dynamic Block / External Request**:

```
ManyChat (IG comment/DM) → POST /api/integrations/manychat/dynamic?token=...
  → ManyChatService: upsert conversación + setter.respond
  → responde JSON v2 con external_message_callback (mantiene el hilo con la IA)
```

---

## 6. Modelo de datos de integraciones

```
channels          transport, (Fase 2) cloud_phone_number_id, cloud_waba_id,
                  cloud_token_enc, cloud_app_secret_enc
conversations     transport, referral(jsonb), window_expires_at, last_template_at,
                  source, source_detail, campaign, consent_optin, proactive_sent,
                  external_subscriber_id
integrations      intake_token, manychat_api_key (CIFRADO), default_channel_id,
                  proactive_enabled
```

---

## 7. Seguridad (auditoría y medidas)

Enforcement real = **service-role + filtro explícito por `organization_id`** en
cada query, con **RLS** como segunda barrera (funciones `user_org_ids()` /
`is_org_admin()` SECURITY DEFINER).

Medidas implementadas:
- **CORS** estricto por allowlist (`CORS_ORIGINS`/`WEB_URL`), métodos y cabeceras acotados.
- **Helmet** (HSTS, X-Content-Type-Options, etc.).
- **Rate limiting** global (`@nestjs/throttler`, 120/min) + límites estrictos en
  endpoints públicos (`/leads` 60/min, ManyChat 120/min, webhook Unipile 600/min).
- **ValidationPipe** `whitelist + forbidNonWhitelisted + forbidUnknownValues` y
  **MaxLength** en todos los inputs de texto (anti abuso de coste LLM/almacenamiento).
- **Secretos cifrados en reposo** (AES-256-GCM, `CryptoService`): API key de
  ManyChat y (Fase 2) tokens de Cloud API. Clave en `FIELD_ENCRYPTION_KEY`.
- **Comparación en tiempo constante** de secretos de webhooks (`timingSafeEqual`).
- **Tokens de intake** criptográficamente seguros (`crypto.randomBytes`).
- **Redacción por rol**: un `closer` no ve `intake_token` ni API keys.
- **Webhooks firmados**: secreto compartido (Unipile) y `X-Hub-Signature-256` (Meta, Fase 2).

Pendiente recomendado:
- Cifrar a futuro cualquier credencial de canal nueva (patrón ya disponible).
- Audit logs de acciones sensibles (rotación de token, cambios de config).
- WAF + MFA en producción (AWS).
