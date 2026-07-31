import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../scripts/environment.js';

loadEnvironment();

const root = fileURLToPath(new URL('..', import.meta.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const tables = await client.query(
  `select tablename from pg_tables where schemaname = 'public' order by 1`
);
console.log('TABLES:', tables.rows.map((r) => r.tablename).join(', '));

const mig = await client.query(
  `select kind, name, checksum, applied_at from schema_migrations order by kind, name`
);
console.log('APPLIED:');
for (const row of mig.rows) {
  console.log(`  ${row.kind}/${row.name} ${String(row.checksum).slice(0, 12)} ${row.applied_at}`);
}

for (const directory of ['migrations', 'seeds'] as const) {
  const names = (await readdir(`${root}/db/${directory}`))
    .filter((n) => n.endsWith('.sql'))
    .sort();
  console.log(`LOCAL_${directory.toUpperCase()}:`);
  for (const name of names) {
    const sql = await readFile(`${root}/db/${directory}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = mig.rows.find((r) => r.kind === directory && r.name === name);
    const status = !applied
      ? 'MISSING'
      : applied.checksum === checksum
        ? 'OK'
        : 'CHECKSUM_MISMATCH';
    console.log(`  ${status} ${name}`);
  }
}

const users = await client.query(
  `select id, nome, email, papel, ativo, criado_em from usuarios order by criado_em`
);
console.log('USERS:', JSON.stringify(users.rows, null, 2));

const admins = await client.query(
  `select count(*)::int as n from usuarios where papel = 'admin' and ativo`
);
console.log('ACTIVE_ADMINS:', admins.rows[0].n);

await client.end();
