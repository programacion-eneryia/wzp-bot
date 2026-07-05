// Aplica un archivo .sql a la base de datos usando DATABASE_URL.
// Uso: node --env-file=../../.env scripts/apply-migration.mjs <ruta.sql>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Falta la ruta del .sql');
  process.exit(1);
}
const sql = readFileSync(resolve(process.cwd(), file), 'utf8');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log('Migración aplicada:', file);
} catch (err) {
  console.error('Error aplicando migración:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
