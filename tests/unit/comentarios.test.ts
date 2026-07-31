import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { filtroStatusComentarioSchema } from '../../packages/contracts/src/comentarios.js';

test('fila de Comentarios aplica limite padrao e rejeita paginas excessivas', () => {
  const defaults = filtroStatusComentarioSchema.parse({ status: 'pendente' });
  assert.equal(defaults.limite, 50);
  assert.equal(defaults.cursor, undefined);

  assert.equal(
    filtroStatusComentarioSchema.safeParse({
      status: 'resolvido',
      limite: '101'
    }).success,
    false
  );
});

async function readPaginationMigration() {
  return readFile(
    new URL(
      '../../db/migrations/0009_paginar_fila_comentarios.sql',
      import.meta.url
    ),
    'utf8'
  );
}

test('nova migration normaliza resolucoes legadas antes de exigir consistencia', async () => {
  const migration = await readPaginationMigration();

  const backfillPosition = migration.indexOf('update comentarios');
  const constraintPosition = migration.indexOf(
    'add constraint comentarios_resolucao_consistente'
  );
  assert.ok(backfillPosition >= 0);
  assert.ok(backfillPosition < constraintPosition);
  assert.match(migration, /status = 'pendente'/);
  assert.match(migration, /resolvido_por = null/);
  assert.match(migration, /resolvido_em = null/);
});

test('nova migration substitui o indice de status pelo indice composto', async () => {
  const migration = await readPaginationMigration();

  assert.match(migration, /drop index idx_comentarios_status/);
  assert.match(migration, /on comentarios\(status, criado_em, id\)/);
});
