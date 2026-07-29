import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const rootDirectory = fileURLToPath(new URL('../..', import.meta.url));

async function runSqlDirectory(client: pg.Client, directory: string) {
  const path = `${rootDirectory}/db/${directory}`;
  const files = (await readdir(path))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    await client.query(await readFile(`${path}/${file}`, 'utf8'));
  }
}

export default async function prepareTestDatabase() {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{ name: string }>(
      'select current_database() as name'
    );
    if (!result.rows[0]?.name.endsWith('_test')) {
      throw new Error('Refusing to reset a database whose name does not end in _test');
    }

    await client.query('drop schema public cascade');
    await client.query('create schema public');
    await runSqlDirectory(client, 'migrations');
    await runSqlDirectory(client, 'seeds');
  } finally {
    await client.end();
  }
}
