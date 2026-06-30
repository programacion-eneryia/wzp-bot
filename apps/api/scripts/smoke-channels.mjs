/**
 * Prueba de humo del flujo de canales (uso local).
 *   node --env-file=../../.env scripts/smoke-channels.mjs <email> <password>
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const api = process.env.API_URL ?? "http://localhost:3001";
const email = process.argv[2];
const password = process.argv[3];

const supabase = createClient(url, anon, { auth: { persistSession: false } });
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error) {
  console.error("❌ Login falló:", error.message);
  process.exit(1);
}
const token = data.session.access_token;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  console.log(`\n${method} ${path} → ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

console.log("✅ Login OK, token obtenido");
await call("GET", "/api/channels");
await call("POST", "/api/channels/connect", { provider: "whatsapp" });
await call("GET", "/api/channels");
