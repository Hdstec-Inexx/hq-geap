import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../../db/migrations/0012_avaliacoes_curador_espelho.sql',
  import.meta.url
);

test('migration cria aggregate separado do Curador ligado a Avaliacao da IA', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /create table avaliacoes_curador/i);
  assert.match(migration, /avaliacao_ia_id\s+uuid\s+not null\s+references avaliacoes/i);
  assert.match(migration, /create table avaliacao_curador_criterios/i);
  assert.match(
    migration,
    /avaliacao_curador_id\s+uuid\s+not null\s+references avaliacoes_curador/i
  );
});

test('migration persiste espelho, nota_avaliacao_ia e comentario opcional sem concordou', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /nota_avaliacao_ia\s+numeric/i);
  assert.match(migration, /falhas_identificadas\s+jsonb/i);
  assert.match(migration, /resumo_atendimento\s+text/i);
  assert.match(migration, /comentario\s+text/i);
  assert.doesNotMatch(migration, /add column\s+concordou\b|\bconcordou\s+/i);
});

test('migration atualiza fila e revisao mais recente para a nova tabela', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /drop view if exists fila_curadoria/i);
  assert.match(migration, /create view fila_curadoria/i);
  assert.match(migration, /from avaliacoes_curador/i);
  assert.match(
    migration,
    /drop view if exists avaliacoes_curador_mais_recentes/i
  );
  assert.match(migration, /create view avaliacoes_curador_mais_recentes/i);
  assert.match(
    migration,
    /from avaliacoes_curador[\s\S]*order by atendimento_id,\s*criado_em desc/i
  );
});

test('migration impede mutacao do aggregate do Curador', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /before update or delete on avaliacoes_curador/i);
  assert.match(
    migration,
    /before update or delete on avaliacao_curador_criterios/i
  );
  assert.match(
    migration,
    /execute function impedir_mutacao_avaliacao\(\)/i
  );
});
