/**
 * Prueba la generación del setter subiendo un documento (PDF/DOCX/TXT).
 *   node --env-file=../../.env scripts/upload-test.mjs <email> <password> <ruta_archivo>
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";

const [email, password, ...filePaths] = process.argv.slice(2);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error) {
  console.error("❌ Login:", error.message);
  process.exit(1);
}

const form = new FormData();
for (const filePath of filePaths) {
  const buf = await readFile(filePath);
  form.append("files", new Blob([buf]), basename(filePath));
}
form.append("apply", "false");

const api = process.env.API_URL ?? "http://localhost:3001";
const res = await fetch(`${api}/api/setter/generate-from-file`, {
  method: "POST",
  headers: { Authorization: `Bearer ${data.session.access_token}` },
  body: form,
});
const json = await res.json();
if (!res.ok) {
  console.error("❌", res.status, json);
  process.exit(1);
}
console.log(`Archivos: ${json.files} | Texto extraído: ${json.extractedChars} caracteres`);
console.log("Campos generados:", Object.keys(json.fields ?? {}).length);
for (const [k, v] of Object.entries(json.fields ?? {})) {
  console.log(`  • ${k}: ${String(v).replace(/\s+/g, " ").slice(0, 80)}`);
}
