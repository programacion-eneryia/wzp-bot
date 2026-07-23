// SOLO LECTURA: mapea canales WhatsApp conectados -> org + número + Unipile.
// Uso: node --env-file=../../.env scripts/diag-channels-map.mjs [numero]
import pg from 'pg';

const needle = process.argv[2] ?? null;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Unipile: cuentas vivas en el tenant.
let unipile = new Map();
try {
  const dsn = process.env.UNIPILE_DSN;
  const key = process.env.UNIPILE_API_KEY;
  if (dsn && key) {
    const res = await fetch(`https://${dsn}/api/v1/accounts`, {
      headers: { 'X-API-KEY': key, accept: 'application/json' },
    });
    const json = await res.json();
    for (const a of json.items ?? []) {
      unipile.set(a.id, {
        name: a.name ?? null,
        type: a.type ?? null,
        status: Array.isArray(a.sources) ? a.sources.map((s) => s.status).join(',') : null,
      });
    }
  }
} catch (e) {
  console.log(`Unipile no consultado: ${String(e)}`);
}
console.log(`Unipile: ${unipile.size} cuentas vivas en el tenant.\n`);

const { rows } = await client.query(
  `select c.id, c.organization_id, o.name as org, o.slug, c.provider, c.status,
          c.display_name, c.unipile_account_id, c.connected_at,
          (select count(*)::int from conversations v where v.channel_id=c.id and v.archived_at is null) as convs
     from channels c
     join organizations o on o.id = c.organization_id
    where ($1::text is null or c.display_name ilike '%'||$1||'%')
    order by o.name, c.provider, c.status`,
  [needle],
);

for (const c of rows) {
  const uni = c.unipile_account_id ? unipile.get(c.unipile_account_id) : null;
  const alive = c.unipile_account_id ? (uni ? 'VIVA en Unipile' : '❌ NO existe en Unipile') : '(sin cuenta Unipile)';
  console.log(`${c.org} (${c.slug})  ${c.provider} ${c.status}`);
  console.log(`   número/display : ${c.display_name ?? '-'}`);
  console.log(`   unipile_id     : ${c.unipile_account_id ?? '-'}  -> ${alive}${uni ? `  [${uni.type} ${uni.status}]` : ''}`);
  console.log(`   convs activas  : ${c.convs}   connected_at: ${c.connected_at ?? '-'}`);
  console.log('');
}

await client.end();
