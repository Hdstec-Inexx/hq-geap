import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../../db/migrations/0007_avaliacoes_curador_imutaveis.sql',
  import.meta.url
);

test('migration preserva a unicidade exclusiva da Avaliacao da IA', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /drop constraint avaliacoes_atendimento_id_autor_key/i);
  assert.match(
    migration,
    /create unique index idx_avaliacoes_ia_unica[\s\S]*where autor = 'ia'/i
  );
});

test('migration preserva a identidade e impede mutacao de Avaliacoes', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /add column autor_usuario_nome text/i);
  assert.match(migration, /avaliacoes_curador_autor_snapshot_check/i);
  assert.match(migration, /before update or delete on avaliacoes/i);
  assert.match(migration, /before update or delete on avaliacao_criterios/i);
  assert.match(migration, /raise exception[^;]*imutavel/i);
});

test('migration inclui a aplicabilidade no snapshot do Criterio', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /add column criterio_condicional boolean/i);
  assert.match(migration, /alter column criterio_condicional set not null/i);
  assert.match(
    migration,
    /before insert on avaliacao_criterios[\s\S]*preencher_criterio_condicional_snapshot/i
  );
});

test('migration identifica a revisao mais recente por Atendimento', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /create view avaliacoes_curador_mais_recentes/i);
  assert.match(migration, /distinct on \(atendimento_id\)/i);
  assert.match(
    migration,
    /order by atendimento_id,\s*criado_em desc,\s*id desc/i
  );
});
