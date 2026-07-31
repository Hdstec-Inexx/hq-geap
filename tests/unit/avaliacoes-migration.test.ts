import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../../db/migrations/0006_persistir_avaliacao_ia.sql',
  import.meta.url
);
const promptSeedPath = new URL(
  '../../db/seeds/0002_prompt_avaliacao_tres_estados.sql',
  import.meta.url
);

test('migration nao fabrica snapshots historicos usando a Regua atual', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.doesNotMatch(migration, /update\s+avaliacao_criterios/i);
  assert.match(migration, /if exists\s*\(\s*select 1 from avaliacao_criterios/i);
  assert.match(migration, /raise exception[^;]*snapshot/i);
});

test('migration cria leases para reivindicar avaliacoes sem chamadas duplicadas', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(migration, /create table avaliacoes_ia_execucoes/i);
  assert.match(migration, /create function reivindicar_avaliacoes_ia/i);
  assert.match(migration, /for update of a skip locked/i);
  assert.match(migration, /lease_ate/i);
  assert.match(migration, /from prompts_ia_avaliadora\s+where ativo/i);
  assert.match(migration, /nao_se_aplica/);
});

test('nova versao do prompt usa o mesmo contrato de tres estados', async () => {
  const seed = await readFile(promptSeedPath, 'utf8');

  assert.match(seed, /saudacao_e_intencao/);
  assert.match(seed, /solicitou_cpf/);
  assert.match(seed, /nao_se_aplica/);
  assert.match(seed, /n.o retorne nota nem aprova..o/i);
  assert.doesNotMatch(seed, /checklist[^;]*boolean/i);
});
