// SOLO LECTURA: diagnóstico del webhook de SALIDA setter -> GHL (setter_id).
// Uso: node --env-file=../../.env scripts/diag-ghl-outbound.mjs
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const mask = (t) => (t ? `${String(t).slice(0, 6)}…${String(t).slice(-4)}` : '(vacío)');

console.log('===== INTEGRACIONES (por org) =====');
const { rows: integ } = await client.query(
  `select i.organization_id, o.name as org, o.slug,
          i.intake_token,
          i.ghl_webhook_url,
          i.proactive_enabled, i.default_channel_id
     from integrations i
     join organizations o on o.id = i.organization_id
     order by o.created_at asc`,
);
for (const r of integ) {
  console.log(`\n- ${r.org} (${r.slug})  org=${r.organization_id}`);
  console.log(`  intake_token   : ${mask(r.intake_token)}`);
  console.log(`  ghl_webhook_url: ${r.ghl_webhook_url ?? '(NO configurada)'}`);
  console.log(`  proactive      : ${r.proactive_enabled}   default_channel: ${r.default_channel_id ?? '-'}`);
  const { rows: ch } = await client.query(
    `select provider, status, count(*)::int n from channels
      where organization_id=$1 group by provider, status order by provider`,
    [r.organization_id],
  );
  console.log(`  canales        : ${ch.map((c) => `${c.provider}:${c.status}(${c.n})`).join(', ') || '(ninguno)'}`);
}

console.log('\n\n===== OUTBOUND_EVENTS (kind=ghl_lead_registered) =====');
const { rows: ev } = await client.query(
  `select e.id, e.organization_id, o.slug, e.conversation_id, e.status,
          e.target_url, e.response, e.created_at
     from outbound_events e
     left join organizations o on o.id = e.organization_id
    where e.kind = 'ghl_lead_registered'
    order by e.created_at desc
    limit 20`,
);
console.log(`Total (últimos 20): ${ev.length}`);
for (const e of ev) {
  console.log('\n  --------------------------------------------');
  console.log(`  ${e.created_at?.toISOString?.() ?? e.created_at}  org=${e.slug}`);
  console.log(`  status : ${e.status}`);
  console.log(`  conv   : ${e.conversation_id}`);
  console.log(`  url    : ${e.target_url}`);
  console.log(`  resp   : ${JSON.stringify(e.response)}`);
}
if (ev.length === 0) {
  console.log('  ⚠️  NO hay NINGÚN intento de salida registrado. El setter nunca llegó');
  console.log('     a llamar a pushLeadRegistered (o el intake nunca corrió).');
}

console.log('\n\n===== LEADS recientes (últimas 48h) =====');
const { rows: leads } = await client.query(
  `select l.id, o.slug, l.name, l.phone, l.source, l.conversation_id, l.created_at
     from leads l left join organizations o on o.id = l.organization_id
    where l.created_at > now() - interval '48 hours'
    order by l.created_at desc limit 20`,
);
console.log(`Leads últimas 48h: ${leads.length}`);
for (const l of leads) {
  console.log(`  [${l.created_at?.toISOString?.() ?? l.created_at}] ${l.slug}  ${l.name ?? '-'}  ${l.phone ?? '-'}  source=${l.source ?? '-'}  conv=${l.conversation_id ?? 'SIN CONV'}`);
}

await client.end();
