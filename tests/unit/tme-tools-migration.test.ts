import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationsDir = new URL('../../db/migrations/', import.meta.url);
const migrationPath = new URL(
  '../../db/migrations/0014_tme_e_tools_kpis.sql',
  import.meta.url
);

test('migration 0014 vem depois da 0013 e persiste TME e contadores de tools', async () => {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const index = files.indexOf('0014_tme_e_tools_kpis.sql');
  assert.ok(index > 0);
  assert.match(files[index - 1]!, /^0013_/);

  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /add column tme_segundos integer/i);
  assert.match(migration, /add column tools_executados integer not null default 0/i);
  assert.match(migration, /add column tools_sucesso integer not null default 0/i);
  assert.match(migration, /atendimentos_tme_segundos_check/i);
  assert.match(migration, /atendimentos_tools_executados_check/i);
  assert.match(migration, /atendimentos_tools_sucesso_check/i);
  assert.match(
    migration,
    /tools_sucesso >= 0 and tools_sucesso <= tools_executados/i
  );
});
