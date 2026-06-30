/**
 * Prueba la reconciliación de canales.
 *   node --env-file=../../.env scripts/reconcile-test.mjs <email> <password>
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
  console.error("❌ Login falló:", error.message);
  process.exit(1);
}
const headers = {
  Authorization: `Bearer ${data.session.access_token}`,
  "Content-Type": "application/json",
};

async function call(method, path) {
  const res = await fetch(`${api}${path}`, { method, headers });
  const json = await res.json().catch(() => null);
  console.log(`\n${method} ${path} → ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
}

await call("POST", "/api/channels/reconcile");
await call("GET", "/api/channels");
