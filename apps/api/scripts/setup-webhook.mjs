/**
 * Registra en Unipile el webhook de mensajería para que nos avise de cada
 * mensaje entrante. Necesitas una URL pública (p.ej. de ngrok).
 *
 *   node --env-file=../../.env scripts/setup-webhook.mjs https://TU-URL-PUBLICA
 *
 * Si no pasas la URL, usa WEBHOOK_BASE_URL del .env.
 */
const dsn = process.env.UNIPILE_DSN;
const apiKey = process.env.UNIPILE_API_KEY;
const secret = process.env.UNIPILE_WEBHOOK_SECRET;
const base = (process.argv[2] ?? process.env.WEBHOOK_BASE_URL ?? "").replace(/\/$/, "");

if (!dsn || !apiKey || !secret) {
  console.error("❌ Faltan UNIPILE_DSN / UNIPILE_API_KEY / UNIPILE_WEBHOOK_SECRET en .env");
  process.exit(1);
}
if (!base || base.startsWith("http://localhost")) {
  console.error("❌ Necesitas una URL pública (ngrok). Ej: node ... scripts/setup-webhook.mjs https://abc123.ngrok-free.app");
  process.exit(1);
}

const requestUrl = `${base}/api/webhooks/unipile/messaging`;

const res = await fetch(`https://${dsn}/api/v1/webhooks`, {
  method: "POST",
  headers: {
    "X-API-KEY": apiKey,
    accept: "application/json",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    source: "messaging",
    request_url: requestUrl,
    name: "wzp-setter-messaging",
    headers: [{ key: "unipile-auth", value: secret }],
  }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`❌ ${res.status}: ${text}`);
  process.exit(1);
}
console.log(`✅ Webhook de mensajería registrado → ${requestUrl}`);
console.log(text);
