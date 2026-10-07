import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationsDir = new URL('../../db/migrations/', import.meta.url);
const migrationPath = new URL(
  '../../db/migrations/0017_favoritos.sql',
  import.meta.url
);

test('migration 0017 vem depois da 0016 e cria a tabela favoritos com constraints e indices', async () => {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const index = files.indexOf('0017_favoritos.sql');
  assert.ok(index > 0, 'Migration 0017_favoritos.sql deve existir e estar no diretório de migrations');
  assert.match(files[index - 1]!, /^0016_/);

  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /create table favoritos/i);
  assert.match(migration, /id\s+uuid\s+primary\s+key/i);
  assert.match(migration, /perfil_id\s+uuid\s+not\s+null\s+references\s+usuarios\s*\(\s*id\s*\)/i);
  assert.match(migration, /atendimento_id\s+uuid\s+not\s+null\s+references\s+atendimentos\s*\(\s*id\s*\)/i);
  assert.match(migration, /favoritado_em\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  assert.match(migration, /unique\s*\(\s*perfil_id\s*,\s*atendimento_id\s*\)/i);
  assert.match(migration, /create\s+index\s+idx_favoritos_atendimento_id\s+on\s+favoritos\s*\(\s*atendimento_id\s*\)/i);
  assert.match(migration, /create\s+index\s+idx_favoritos_perfil_id\s+on\s+favoritos\s*\(\s*perfil_id\s*\)/i);
});
