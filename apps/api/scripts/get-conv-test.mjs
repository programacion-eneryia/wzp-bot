/** Abre la primera conversación del inbox y muestra cuántos mensajes trae. */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await supabase.auth.signInWithPassword({
  email: process.argv[2],
  password: process.argv[3],
});
if (error) {
  console.error("❌ Login:", error.message);
  process.exit(1);
}
const api = process.env.API_URL ?? "http://localhost:3001";
const token = data.session.access_token;

const list = await fetch(`${api}/api/inbox/conversations`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

const conv = list[0];
console.log("Abriendo:", conv.contact_name, conv.id);

const detail = await fetch(`${api}/api/inbox/conversations/${conv.id}`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

console.log("mensajes:", detail.messages.length);
for (const m of detail.messages.slice(-6)) {
  console.log(`  [${m.role}] ${m.content.slice(0, 70)}`);
}
