import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../../db/migrations/0010_avaliacao_ia_contrato_tipado.sql',
  import.meta.url
);
const promptSeedPath = new URL(
  '../../db/seeds/0004_prompt_avaliacao_contrato_booleano.sql',
  import.meta.url
);

const checklistKeysV7 = [
  'saudacao_e_intencao',
  'solicitou_cpf',
  'informou_protocolo_email',
  'resolveu_solicitacao',
  'validou_email_por_extenso',
  'sem_diminutivos',
  'encerramento_geap'
];

const checklistKeys = [...checklistKeysV7, 'uso_correto_ferramentas'];

const ferramentasMigrationPath = new URL(
  '../../db/migrations/0013_uso_correto_ferramentas.sql',
  import.meta.url
);
const ferramentasPromptSeedPath = new URL(
  '../../db/seeds/0005_uso_correto_ferramentas.sql',
  import.meta.url
);

test('migration persiste o contrato tipado da LLM na Avaliacao da IA', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  for (const chave of checklistKeysV7) {
    assert.match(migration, new RegExp(`add column ${chave}\\s+boolean`, 'i'));
  }
  assert.match(migration, /add column atendimento_aprovado\s+boolean/i);
  assert.match(migration, /add column nota_qualidade\s+numeric/i);
  assert.match(
    migration,
    /autor = 'ia'[\s\S]*saudacao_e_intencao is not null[\s\S]*nota_qualidade is not null/i
  );
});

test('migration mantem no maximo uma Avaliacao da IA por Atendimento', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(
    migration,
    /idx_avaliacoes_ia_unica|unique[\s\S]*autor = 'ia'|atendimento_id[\s\S]*autor = 'ia'/i
  );
});

test('persistir_avaliacao_ia aceita checklist booleano e claims da LLM', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(
    migration,
    /create or replace function persistir_avaliacao_ia\s*\(/i
  );
  assert.match(migration, /p_atendimento_aprovado\s+boolean/i);
  assert.match(migration, /p_nota_qualidade\s+numeric/i);
  assert.match(
    migration,
    /jsonb_each\(p_checklist\)[\s\S]*jsonb_typeof\([\s\S]*\) is distinct from 'boolean'/i
  );
  assert.match(migration, /nota_qualidade/i);
  assert.match(migration, /atendimento_aprovado/i);
  assert.match(
    migration,
    /case when[\s\S]*then 'atendido'::estado_criterio[\s\S]*else 'nao_atendido'::estado_criterio/i
  );
});

test('reivindicar_avaliacoes_ia expoe schema booleano do checklist', async () => {
  const migration = await readFile(migrationPath, 'utf8');

  assert.match(
    migration,
    /create or replace function reivindicar_avaliacoes_ia/i
  );
  assert.match(migration, /'type',\s*'boolean'/i);
  assert.doesNotMatch(
    migration,
    /jsonb_build_array\(\s*'atendido',\s*'nao_atendido'/i
  );
});

test('nova versao do prompt alinha ao contrato booleano da LLM', async () => {
  const seed = await readFile(promptSeedPath, 'utf8');

  for (const chave of checklistKeysV7) {
    assert.match(seed, new RegExp(chave));
  }
  assert.match(seed, /atendimento_aprovado/);
  assert.match(seed, /nota_qualidade/);
  assert.match(seed, /boolean/i);
  assert.doesNotMatch(seed, /nao_se_aplica/);
});

test('migration inclui uso_correto_ferramentas, Criterio valor 0 e gate na persistencia', async () => {
  const migration = await readFile(ferramentasMigrationPath, 'utf8');

  assert.match(migration, /add column uso_correto_ferramentas\s+boolean/i);
  assert.match(
    migration,
    /'uso_correto_ferramentas'[\s\S]*'Uso Correto de Ferramentas'/i
  );
  assert.match(migration, /,\s*0\s*,\s*false\s*,\s*false\s*,\s*true\s*,\s*8/i);
  assert.match(
    migration,
    /uso_correto_ferramentas[\s\S]*resolveu_solicitacao[\s\S]*false/i
  );
  assert.match(migration, /persistir_avaliacao_ia/i);
  // Backfill da coluna tipada precisa preceder o novo CHECK (padrão 0010).
  const backfillAt = migration.search(
    /update avaliacoes[\s\S]*uso_correto_ferramentas\s*=\s*true/i
  );
  const newCheckAt = migration.search(
    /add constraint avaliacoes_ia_contrato_tipado_check/i
  );
  assert.ok(backfillAt >= 0 && newCheckAt >= 0 && backfillAt < newCheckAt);
});

test('seed alinha prompt e Regua ao contrato de 8 chaves booleanas', async () => {
  const seed = await readFile(ferramentasPromptSeedPath, 'utf8');

  for (const chave of checklistKeys) {
    assert.match(seed, new RegExp(chave));
  }
  assert.match(seed, /Uso Correto de Ferramentas/i);
  assert.match(seed, /8 chaves|oito chaves|8ª|oitava/i);
  assert.match(
    seed,
    /uso_correto_ferramentas[\s\S]*resolveu_solicitacao|ferramentas[\s\S]*resolu/i
  );
});
