/**
 * Prueba end-to-end del setter con IA (config + playground).
 *   node --env-file=../../.env scripts/setter-smoke.mjs <email> <password>
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

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`\n❌ ${method} ${path} → ${res.status}`, json);
    process.exit(1);
  }
  return json;
}

// 1) Configurar el setter con la oferta de consultoría B2B.
await call("PUT", "/api/setter/config", {
  setter_name: "Alex",
  identity_role: "consultor del equipo de Eneryia",
  company_name: "Eneryia",
  offer:
    "Consultoría para empresas B2B que quieren sistematizar su captación de clientes y escalar ventas con procesos y automatización.",
  objective:
    "Cualificar al lead y, si encaja, agendar una llamada de diagnóstico gratuita con un consultor.",
  qualification_criteria:
    "- Es una empresa B2B con un servicio o producto ya validado.\n- Tiene equipo o facturación que justifique invertir en crecer.\n- Busca crecer en los próximos meses y tiene cierta urgencia.",
  tone: "Cercano, humano y profesional. Tutea. Mensajes cortos, como por WhatsApp.",
  rules:
    "No des precios por chat. No te enrolles. No presiones. Si encaja, lleva la conversación hacia agendar la llamada.",
});
console.log("✅ Config del setter guardada");

// 2) Crear conversación de prueba.
const conv = await call("POST", "/api/playground/conversations", {
  provider: "whatsapp",
  contact_name: "Carlos (lead B2B)",
});
console.log(`✅ Conversación creada: ${conv.id}`);

// 3) Simular mensajes del lead y ver cómo responde el setter.
const leadTurns = [
  "hola vi tu anuncio, q ofreceis?",
  "tengo una agencia de diseño, facturamos unos 15k al mes pero estancados",
];

for (const turn of leadTurns) {
  console.log(`\n🧑 Lead: ${turn}`);
  const { reply } = await call(
    "POST",
    `/api/playground/conversations/${conv.id}/messages`,
    { content: turn },
  );
  for (const b of reply) {
    console.log(`🤖 Setter (${b.delayMs}ms): ${b.content}`);
  }
}
