/**
 * Aplica TODAS las migraciones SQL de supabase/migrations en orden alfabético,
 * conectando directo a Postgres por el pooler (sin pasar por la capa REST).
 *
 * Las migraciones están escritas para ser idempotentes (create if not exists,
 * create or replace, drop policy if exists...), así que es seguro re-ejecutarlas.
 *
 * Uso (desde apps/api):
 *   node --env-file=../../.env scripts/migrate.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ Falta DATABASE_URL");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../supabase/migrations");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log(`✅ Conectado. Aplicando ${files.length} migración(es)...`);

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await client.query(sql);
    console.log(`  ✓ ${file}`);
  }

  await client.query("notify pgrst, 'reload schema'");
  console.log("✅ Migraciones aplicadas y caché de esquema recargado");
  await client.end();
}

main().catch(async (err) => {
  console.error("❌ Error:", err.message ?? err);
  try {
    await client.end();
  } catch {
    // noop
  }
  process.exit(1);
});
