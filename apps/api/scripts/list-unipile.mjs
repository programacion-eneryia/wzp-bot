/** Inspección acotada de cuentas en Unipile (solo campos de correlación). */
const dsn = process.env.UNIPILE_DSN;
const key = process.env.UNIPILE_API_KEY;
const res = await fetch(`https://${dsn}/api/v1/accounts`, {
  headers: { "X-API-KEY": key, accept: "application/json" },
});
const json = await res.json();
const items = json.items ?? [];
console.log("Cuentas:", items.length);
for (const a of items) {
  console.log({
    keys: Object.keys(a),
    id_present: Boolean(a.id),
    name: a.name ?? null,
    type: a.type ?? null,
    sources_status: Array.isArray(a.sources)
      ? a.sources.map((s) => s.status)
      : null,
  });
}
