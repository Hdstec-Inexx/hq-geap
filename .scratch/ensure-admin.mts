import pg from 'pg';
import { loadEnvironment } from '../scripts/environment.js';

loadEnvironment();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const existing = await client.query(
  `select id, email, ativo from usuarios where papel = 'admin' order by criado_em`
);
console.log('admins_before', existing.rows);

const active = existing.rows.find((row) => row.ativo);
if (!active) {
  await client.query(
    `insert into usuarios (nome, email, senha_hash, papel)
     values ('Administrador HQ', 'admin@hq.local', crypt('senha-admin', gen_salt('bf')), 'admin')`
  );
  console.log('created admin@hq.local with password senha-admin');
} else {
  console.log('active_admin_exists', active.email);
}

const tables = await client.query(`
  select tablename
  from pg_tables
  where schemaname = 'public'
  order by 1
`);
console.log('tables', tables.rows.map((row) => row.tablename));

const migrations = await client.query(
  `select kind, name from schema_migrations order by kind, name`
);
console.log(
  'schema_migrations',
  migrations.rows.map((row) => `${row.kind}/${row.name}`)
);

await client.end();
