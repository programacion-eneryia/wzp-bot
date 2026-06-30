/** Prueba la sincronización de chats del inbox. */
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
const res = await fetch(`${api}/api/inbox/sync`, {
  method: "POST",
  headers: { Authorization: `Bearer ${data.session.access_token}` },
});
const json = await res.json();
console.log("status", res.status);
console.log(json);

const list = await fetch(`${api}/api/inbox/conversations`, {
  headers: { Authorization: `Bearer ${data.session.access_token}` },
}).then((r) => r.json());
console.log("conversaciones:", Array.isArray(list) ? list.length : list);
if (Array.isArray(list)) {
  for (const c of list.slice(0, 8)) {
    console.log(`  • ${c.contact_name} | ${c.provider} | IA:${c.ai_enabled ? "ON" : "off"} | ${c.last_message_at ?? "-"}`);
  }
}
