import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadEnvironment } from '../scripts/environment.js';

loadEnvironment();

async function hashFile(path: string) {
  const sql = await readFile(path);
  const asIs = createHash('sha256').update(sql).digest('hex');
  const lf = createHash('sha256')
    .update(Buffer.from(sql.toString('utf8').replace(/\r\n/g, '\n')))
    .digest('hex');
  const crlf = createHash('sha256')
    .update(Buffer.from(sql.toString('utf8').replace(/\n/g, '\r\n').replace(/\r\r\n/g, '\r\n')))
    .digest('hex');
  return { bytes: sql.length, asIs, lf, crlf, hasCR: sql.includes(0x0d) };
}

const files = [
  'db/migrations/0001_init.sql',
  'db/seeds/0001_seed.sql'
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const file of files) {
  const local = await hashFile(file);
  const kind = file.includes('migrations') ? 'migrations' : 'seeds';
  const name = file.split('/').pop()!;
  const applied = await client.query(
    'select checksum from schema_migrations where kind = $1 and name = $2',
    [kind, name]
  );
  console.log(file, local, 'applied', applied.rows[0]?.checksum);
}
await client.end();
