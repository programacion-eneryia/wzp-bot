/**
 * Seed de arranque: crea la primera organización y su usuario admin.
 *
 * Uso (desde apps/api):
 *   node --env-file=../../.env scripts/seed.mjs <email> "<Nombre Org>"
 *
 * Es idempotente: si la organización o el usuario ya existen, los reutiliza.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env");
  process.exit(1);
}

const email = process.argv[2];
const orgName = process.argv[3];

if (!email || !orgName) {
  console.error('Uso: node --env-file=../../.env scripts/seed.mjs <email> "<Nombre Org>"');
  process.exit(1);
}

const slug = orgName
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

function generatePassword() {
  // 16 chars seguros, fáciles de copiar.
  return randomBytes(16).toString("base64").replace(/[+/=]/g, "").slice(0, 16);
}

const password = process.env.SEED_ADMIN_PASSWORD ?? generatePassword();

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // 1) Organización (por slug, idempotente)
  let { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!org) {
    const { data, error } = await supabase
      .from("organizations")
      .insert({ name: orgName, slug })
      .select()
      .single();
    if (error) throw error;
    org = data;
    console.log(`✅ Organización creada: ${org.name} (${org.slug})`);
  } else {
    console.log(`ℹ️  Organización ya existía: ${org.name} (${org.slug})`);
  }

  // 2) Usuario admin
  let userId;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Administrador" },
  });

  if (createErr) {
    // Probablemente ya existe: lo buscamos.
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email === email);
    if (!existing) throw createErr;
    userId = existing.id;
    console.log(`ℹ️  Usuario ya existía: ${email} (no se cambia la contraseña)`);
  } else {
    userId = created.user.id;
    console.log(`✅ Usuario admin creado: ${email}`);
  }

  // 3) Membership admin (idempotente)
  const { error: memErr } = await supabase
    .from("memberships")
    .upsert(
      { organization_id: org.id, user_id: userId, role: "admin" },
      { onConflict: "organization_id,user_id" },
    );
  if (memErr) throw memErr;
  console.log("✅ Membership admin asegurada");

  console.log("\n──────────── CREDENCIALES ────────────");
  console.log(`  Email:       ${email}`);
  if (!createErr) {
    console.log(`  Contraseña:  ${password}`);
    console.log("  (Cámbiala tras el primer login)");
  } else {
    console.log("  Contraseña:  (sin cambios, usa la que ya tenías)");
  }
  console.log("──────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("❌ Error en el seed:", err.message ?? err);
  process.exit(1);
});
