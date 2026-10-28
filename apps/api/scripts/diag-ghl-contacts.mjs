#!/usr/bin/env node
/**
 * Diagnóstico de SOLO LECTURA de los contactos de una subcuenta de GHL.
 * No modifica nada: lista lo que conviene revisar a mano, cuenta por cuenta.
 *
 *   GHL_TOKEN=pit-… GHL_LOCATION_ID=… node scripts/diag-ghl-contacts.mjs
 *   Opcional: GHL_BOT_TAGS="setter-ia,setter-ia-whatsapp" GHL_BOT_SOURCE="Setter IA (chat)"
 *
 * Informa de:
 *   1. Contactos duplicados por variantes del mismo teléfono (+52/+521, +54/+549,
 *      Brasil con/sin 9, con/sin +).
 *   2. Contactos que SOLO tienen etiquetas del bot (perdieron las del embudo).
 *   3. Contactos cuyo origen (source) es el del bot (posible origen pisado).
 */

const API = 'https://services.leadconnectorhq.com';
const token = process.env.GHL_TOKEN;
const locationId = process.env.GHL_LOCATION_ID;
const botTags = (process.env.GHL_BOT_TAGS ?? 'setter-ia,setter-ia-whatsapp,setter-ia-instagram')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);
const botSource = (process.env.GHL_BOT_SOURCE ?? 'Setter IA (chat)').trim().toLowerCase();

if (!token || !locationId) {
  console.error('Faltan GHL_TOKEN y/o GHL_LOCATION_ID en el entorno.');
  process.exit(1);
}

// Misma normalización que apps/api/src/common/phone.ts (duplicada aquí para
// que el script no dependa de la build de TypeScript).
function canonicalDigits(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^521\d{10}$/.test(d)) return `52${d.slice(3)}`;
  if (/^549\d{10}$/.test(d)) return `54${d.slice(3)}`;
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

async function searchPage(searchAfter) {
  const body = { locationId, pageLimit: 500 };
  if (searchAfter) body.searchAfter = searchAfter;
  const res = await fetch(`${API}/contacts/search`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      version: '2021-07-28',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') || 2);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return searchPage(searchAfter);
  }
  if (!res.ok) throw new Error(`GHL /contacts/search → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function allContacts() {
  const out = [];
  let searchAfter = null;
  for (;;) {
    const page = await searchPage(searchAfter);
    const items = page.contacts ?? [];
    out.push(...items);
    const last = items[items.length - 1];
    if (!last || items.length < 500 || !last.searchAfter) break;
    searchAfter = last.searchAfter;
  }
  return out;
}

const label = (c) =>
  `${c.id}  ${[c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || '(sin nombre)'}  ${c.phone ?? '-'}  ${c.email ?? '-'}  [${(c.tags ?? []).join(', ')}]  source=${c.source ?? '-'}  creado=${(c.dateAdded ?? '').slice(0, 10)}`;

const contacts = await allContacts();
console.log(`Subcuenta ${locationId}: ${contacts.length} contactos\n`);

// 1) Duplicados por teléfono equivalente.
const byPhone = new Map();
for (const c of contacts) {
  const k = canonicalDigits(c.phone);
  if (k.length < 7) continue;
  byPhone.set(k, [...(byPhone.get(k) ?? []), c]);
}
const dups = [...byPhone.values()].filter((g) => g.length > 1);
console.log(`1) Duplicados por teléfono equivalente: ${dups.length} grupos`);
for (const g of dups) {
  console.log(`   +${canonicalDigits(g[0].phone)}`);
  for (const c of g.sort((a, b) => String(a.dateAdded).localeCompare(String(b.dateAdded)))) console.log(`     - ${label(c)}`);
}

// 2) Solo etiquetas del bot.
const onlyBot = contacts.filter((c) => {
  const tags = (c.tags ?? []).map((t) => String(t).toLowerCase());
  return tags.length > 0 && tags.every((t) => botTags.includes(t));
});
console.log(`\n2) Contactos que SOLO tienen etiquetas del bot: ${onlyBot.length}`);
for (const c of onlyBot) console.log(`   - ${label(c)}`);

// 3) Origen del bot.
const botSourced = contacts.filter((c) => String(c.source ?? '').trim().toLowerCase() === botSource);
console.log(`\n3) Contactos con source del bot ("${botSource}"): ${botSourced.length}`);
for (const c of botSourced) console.log(`   - ${label(c)}`);

console.log('\nSolo lectura: no se ha modificado nada en GHL.');
