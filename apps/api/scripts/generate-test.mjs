/**
 * Prueba la generación de la config del setter con IA (sin aplicar).
 *   node --env-file=../../.env scripts/generate-test.mjs <email> <password>
 */
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

const brief = `Somos Eneryia, una consultoría B2B. Ayudamos a agencias y empresas de servicios a
sistematizar su captación de clientes: dejar de depender de referidos y montar un sistema
de prospección + cierre predecible. Trabajamos con negocios que ya facturan y quieren escalar.
Caso: una agencia pasó de 15k a 40k/mes en 4 meses. El objetivo del chat es cualificar y
agendar una llamada de diagnóstico gratuita.`;

const res = await fetch(`${api}/api/setter/generate`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ brief, apply: false }),
});
const json = await res.json();
if (!res.ok) {
  console.error("❌", res.status, json);
  process.exit(1);
}
const fields = json.fields ?? {};
console.log("Campos generados:", Object.keys(fields).length);
for (const [k, v] of Object.entries(fields)) {
  const preview = String(v).replace(/\s+/g, " ").slice(0, 90);
  console.log(`  • ${k}: ${preview}${String(v).length > 90 ? "…" : ""}`);
}
