import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap';

type DatabaseFile = {
  name: string;
  sql: string;
  checksum: string;
};

async function databaseFiles(directory: 'migrations' | 'seeds') {
  const path = `${rootDirectory}/db/${directory}`;
  const names = (await readdir(path))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  return Promise.all(
    names.map(async (name): Promise<DatabaseFile> => {
      const sql = await readFile(`${path}/${name}`, 'utf8');
      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex')
      };
    })
  );
}

async function apply(directory: 'migrations' | 'seeds') {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        kind text not null,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now(),
        primary key (kind, name)
      )
    `);

    for (const file of await databaseFiles(directory)) {
      const applied = await client.query<{ checksum: string }>(
        'select checksum from schema_migrations where kind = $1 and name = $2',
        [directory, file.name]
      );

      if (applied.rowCount) {
        if (applied.rows[0]?.checksum !== file.checksum) {
          throw new Error(`${directory}/${file.name} changed after being applied`);
        }
        continue;
      }

      await client.query('begin');
      try {
        await client.query(file.sql);
        await client.query(
          'insert into schema_migrations (kind, name, checksum) values ($1, $2, $3)',
          [directory, file.name, file.checksum]
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

async function validate() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query('begin');

  try {
    const schema = `migration_validation_${process.pid}`;
    await client.query(`create schema ${schema}`);
    await client.query(`set local search_path to ${schema}, public`);

    for (const directory of ['migrations', 'seeds'] as const) {
      for (const file of await databaseFiles(directory)) {
        await client.query(file.sql);
      }
    }

    const result = await client.query<{
      active_criteria: string;
      total: string;
      active_prompts: string;
    }>(`
      select
        count(*) filter (where ativo) as active_criteria,
        coalesce(sum(valor) filter (where ativo), 0) as total,
        (select count(*) from prompts_ia_avaliadora where ativo) as active_prompts
      from criterios
    `);
    const row = result.rows[0];

    if (
      row?.active_criteria !== '7' ||
      Number(row.total) !== 10 ||
      row.active_prompts !== '1'
    ) {
      throw new Error('Initial seed must contain seven active criteria totaling 10 and one active prompt');
    }
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

const command = process.argv[2];

if (command === 'migrate') {
  await apply('migrations');
} else if (command === 'seed') {
  await apply('seeds');
} else if (command === 'validate') {
  await validate();
} else {
  throw new Error('Usage: database.ts <migrate|seed|validate>');
}
