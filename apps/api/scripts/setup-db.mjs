/**
 * Setup completo de la base de datos, conectando DIRECTO a Postgres (pooler),
 * sin depender de la capa REST de Supabase (que puede tener el caché desfasado).
 *
 * Hace, de forma idempotente:
 *   1. Aplica la migración 0001_foundation.sql.
 *   2. Recarga el caché de esquema de PostgREST (NOTIFY pgrst).
 *   3. Crea el usuario admin (vía GoTrue admin API).
 *   4. Crea la organización + membership admin (vía SQL directo).
 *
 * Uso (desde apps/api):
 *   node --env-file=../../.env scripts/setup-db.mjs <email> "<Nombre Org>"
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const dbUrl = process.env.DATABASE_URL;
const supaUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const orgName = process.argv[3];

if (!dbUrl || !supaUrl || !serviceKey) {
  console.error("❌ Faltan DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!email || !orgName) {
  console.error('Uso: node --env-file=../../.env scripts/setup-db.mjs <email> "<Org>"');
  process.exit(1);
}

const slug = orgName
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(16).toString("base64").replace(/[+/=]/g, "").slice(0, 16);

const migrationSql = readFileSync(
  new URL("../../../supabase/migrations/0001_foundation.sql", import.meta.url),
  "utf8",
);

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log("✅ Conectado a Postgres (pooler)");

  // 1) Migración
  await client.query(migrationSql);
  console.log("✅ Migración 0001 aplicada");

  // 2) Recargar caché de PostgREST
  await client.query("notify pgrst, 'reload schema'");
  console.log("✅ Caché de esquema recargado (NOTIFY pgrst)");

  // 3) Usuario admin (GoTrue admin API)
  const supabase = createClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId;
  let createdNow = false;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Administrador" },
  });

  if (createErr) {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email === email);
    if (!existing) throw createErr;
    userId = existing.id;
    console.log(`ℹ️  Usuario ya existía: ${email}`);
  } else {
    userId = created.user.id;
    createdNow = true;
    console.log(`✅ Usuario admin creado: ${email}`);
  }

  // Aseguramos el profile (por si el trigger no corrió antes de existir el user)
  await client.query(
    `insert into public.profiles (id, email, full_name)
     values ($1, $2, 'Administrador')
     on conflict (id) do nothing`,
    [userId, email],
  );

  // 4) Organización + membership (SQL directo)
  const orgRes = await client.query(
    `insert into public.organizations (name, slug)
     values ($1, $2)
     on conflict (slug) do update set name = excluded.name
     returning id, name, slug`,
    [orgName, slug],
  );
  const org = orgRes.rows[0];
  console.log(`✅ Organización: ${org.name} (${org.slug})`);

  await client.query(
    `insert into public.memberships (organization_id, user_id, role)
     values ($1, $2, 'admin')
     on conflict (organization_id, user_id) do update set role = 'admin'`,
    [org.id, userId],
  );
  console.log("✅ Membership admin asegurada");

  await client.end();

  console.log("\n──────────── CREDENCIALES ────────────");
  console.log(`  Email:       ${email}`);
  console.log(`  Contraseña:  ${createdNow ? password : "(sin cambios, la que ya tenías)"}`);
  console.log("──────────────────────────────────────\n");
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
