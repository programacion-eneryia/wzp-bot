/** Smoke test del inbox: lista conversaciones reales. */
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
const res = await fetch(`${api}/api/inbox/conversations`, {
  headers: { Authorization: `Bearer ${data.session.access_token}` },
});
const json = await res.json();
console.log("status", res.status);
console.log("conversaciones:", Array.isArray(json) ? json.length : json);
