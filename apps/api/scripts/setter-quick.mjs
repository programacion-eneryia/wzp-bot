/**
 * Prueba rápida del setter SIN tocar la config (usa la que ya exista).
 *   node --env-file=../../.env scripts/setter-quick.mjs <email> <password> "<mensaje>"
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const api = process.env.API_URL ?? "http://localhost:3001";

const supabase = createClient(url, anon, { auth: { persistSession: false } });
const { data, error } = await supabase.auth.signInWithPassword({
  email: process.argv[2],
  password: process.argv[3],
});
if (error) {
  console.error("❌ Login:", error.message);
  process.exit(1);
}
const headers = {
  Authorization: `Bearer ${data.session.access_token}`,
  "Content-Type": "application/json",
};
const msg = process.argv[4] ?? "hola, tengo una agencia de marketing, que haceis?";

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`❌ ${method} ${path} → ${res.status}`, json);
    process.exit(1);
  }
  return json;
}

const conv = await call("POST", "/api/playground/conversations", {
  provider: "whatsapp",
  contact_name: "Test formato",
});
console.log(`🧑 Lead: ${msg}\n`);
const { reply } = await call(
  "POST",
  `/api/playground/conversations/${conv.id}/messages`,
  { content: msg },
);
console.log(`Burbujas devueltas: ${reply.length}`);
reply.forEach((b, i) => console.log(`  [${i + 1}] (${b.delayMs}ms) ${b.content}`));

// Limpieza: borramos la conversación de prueba.
await call("DELETE", `/api/playground/conversations/${conv.id}`);
console.log("\n(conversación de prueba eliminada)");
