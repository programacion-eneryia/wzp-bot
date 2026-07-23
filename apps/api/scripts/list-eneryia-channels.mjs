// SOLO LECTURA: lista los canales/conexiones de la(s) cuenta(s) que coincidan
// con "eneryia" (la cuenta de administración) y los cruza con Unipile.
// No desconecta ni borra nada.
// Uso: node --env-file=../../.env scripts/list-eneryia-channels.mjs [filtro]
import pg from 'pg';

const filter = process.argv[2] ?? 'eneryia';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: orgs } = await client.query(
  `select id, name, slug, created_at
     from organizations
    where name ilike '%'||$1||'%' or slug ilike '%'||$1||'%'
    order by created_at asc`,
  [filter],
);

if (orgs.length === 0) {
  console.log(`No hay organizaciones que coincidan con "${filter}".`);
  await client.end();
  process.exit(0);
}

// Cuentas en Unipile (para correlacionar por unipile_account_id).
let unipileById = new Map();
try {
  const dsn = process.env.UNIPILE_DSN;
  const key = process.env.UNIPILE_API_KEY;
  if (dsn && key) {
    const res = await fetch(`https://${dsn}/api/v1/accounts`, {
      headers: { 'X-API-KEY': key, accept: 'application/json' },
    });
    const json = await res.json();
    for (const a of json.items ?? []) {
      unipileById.set(a.id, {
        name: a.name ?? null,
        type: a.type ?? null,
        status: Array.isArray(a.sources) ? a.sources.map((s) => s.status).join(',') : null,
      });
    }
    console.log(`Unipile: ${unipileById.size} cuentas en el tenant.\n`);
  } else {
    console.log('Unipile: sin UNIPILE_DSN/UNIPILE_API_KEY, no se cruza.\n');
  }
} catch (e) {
  console.log(`Unipile: no se pudo consultar (${String(e)}).\n`);
}

for (const org of orgs) {
  console.log('==================================================');
  console.log(`ORG: ${org.name}  (slug: ${org.slug})  id=${org.id}`);

  const { rows: channels } = await client.query(
    `select id, provider, status, transport, unipile_account_id, display_name,
            connected_at, created_at
       from channels
      where organization_id = $1
      order by created_at asc`,
    [org.id],
  );

  const active = channels.filter((c) => c.status !== 'disconnected');
  console.log(`Canales: ${channels.length} (activos/no-desconectados: ${active.length})`);

  for (const c of channels) {
    const uni = c.unipile_account_id ? unipileById.get(c.unipile_account_id) : null;
    const { rows: convCount } = await client.query(
      `select count(*)::int as n from conversations
        where channel_id = $1 and archived_at is null`,
      [c.id],
    );
    console.log('  --------------------------------------------');
    console.log(`  channel_id : ${c.id}`);
    console.log(`  provider   : ${c.provider}   transport: ${c.transport}`);
    console.log(`  status     : ${c.status}`);
    console.log(`  display    : ${c.display_name ?? '(sin nombre)'}`);
    console.log(`  unipile_id : ${c.unipile_account_id ?? '(ninguno)'}`);
    if (uni) {
      console.log(`  unipile    : name=${uni.name} type=${uni.type} sources=${uni.status}`);
    } else if (c.unipile_account_id) {
      console.log('  unipile    : (no encontrada en el tenant Unipile)');
    }
    console.log(`  conv activas (no archivadas): ${convCount[0].n}`);
    console.log(`  connected_at: ${c.connected_at ?? '-'}   created_at: ${c.created_at}`);
  }
  console.log('');
}

await client.end();
