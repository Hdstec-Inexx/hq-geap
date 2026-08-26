import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import prepareTestDatabase from '../support/test-db.js';

const { Client } = pg;

type ReprocessamentoRastreamentoRow = {
  id?: string;
  reprocessamento_tentativas: number;
  reprocessamento_ignorado: boolean;
  reprocessamento_ultimo_erro: string | null;
};

const migrationsDir = new URL('../../db/migrations/', import.meta.url);
const migrationPath = new URL(
  '../../db/migrations/0016_reprocessamento_tentativas_e_descarte.sql',
  import.meta.url
);

test('migration 0016 vem depois da 0015 e adiciona colunas e indice para reprocessamento', async () => {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const index = files.indexOf('0016_reprocessamento_tentativas_e_descarte.sql');
  assert.ok(index > 0, 'Migration 0016 deve existir na pasta db/migrations');
  assert.match(files[index - 1]!, /^0015_/, 'Migration anterior deve ser a 0015');

  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /add column reprocessamento_tentativas smallint not null default 0/i);
  assert.match(migration, /add column reprocessamento_ignorado boolean not null default false/i);
  assert.match(migration, /add column reprocessamento_ultimo_erro text/i);
  assert.match(migration, /atendimentos_reprocessamento_tentativas_check/i);
  assert.match(migration, /reprocessamento_tentativas >= 0/i);
  assert.match(migration, /create index idx_atendimentos_reprocessamento_pendente/i);
  assert.match(migration, /on atendimentos\s*\(\s*concluido_em\s+asc\s*\)/i);
  assert.match(migration, /status\s*=\s*'concluido'/i);
  assert.match(migration, /(not\s+reprocessamento_ignorado|reprocessamento_ignorado\s*=\s*false)/i);
  assert.match(migration, /reprocessamento_tentativas\s*<\s*3/i);
  assert.match(migration, /concluido_em\s*<\s*'2026-08-19'/i);
});

test('tabela atendimentos aplica defaults retrocompativeis e restricoes de rastreamento', async () => {
  await prepareTestDatabase();

  const connectionString =
    process.env.TEST_DATABASE_URL ??
    'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Cria um agente de voz para vincular atendimentos
    const agenteResult = await client.query<{ id: string }>(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Teste Rastreamento', 'agent-rastreamento-test-001')
      returning id
    `);
    const agenteVozId = agenteResult.rows[0]?.id;
    assert.ok(agenteVozId);

    // 2. Insere atendimento SEM informar as novas colunas (compatibilidade retroativa tipo n8n)
    const insertResult = await client.query<ReprocessamentoRastreamentoRow>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em
      ) values (
        $1, 'conv-rastreamento-default-test', 'concluido', '2026-08-15 10:00:00+00', '2026-08-15 10:05:00+00'
      )
      returning id, reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
    `, [agenteVozId]);

    const row = insertResult.rows[0];
    assert.ok(row);
    assert.equal(row.reprocessamento_tentativas, 0);
    assert.equal(row.reprocessamento_ignorado, false);
    assert.equal(row.reprocessamento_ultimo_erro, null);

    // 3. Atualiza colunas de rastreamento (fluxo de erro / descarte)
    await client.query(`
      update atendimentos
      set reprocessamento_tentativas = 1,
          reprocessamento_ignorado = true,
          reprocessamento_ultimo_erro = '404 Not Found'
      where id = $1
    `, [row.id]);

    const updatedResult = await client.query<ReprocessamentoRastreamentoRow>(`
      select reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      from atendimentos
      where id = $1
    `, [row.id]);

    const updatedRow = updatedResult.rows[0];
    assert.ok(updatedRow);
    assert.equal(updatedRow.reprocessamento_tentativas, 1);
    assert.equal(updatedRow.reprocessamento_ignorado, true);
    assert.equal(updatedRow.reprocessamento_ultimo_erro, '404 Not Found');

    // 4. Constraint check: tentativas não podem ser negativas
    await assert.rejects(
      async () => {
        await client.query(`
          update atendimentos
          set reprocessamento_tentativas = -1
          where id = $1
        `, [row.id]);
      },
      /atendimentos_reprocessamento_tentativas_check|check constraint/i
    );

    // 5. Verifica se o índice parcial foi criado no catálogo do Postgres
    const indexResult = await client.query<{ indexname: string; indexdef: string }>(`
      select indexname, indexdef
      from pg_indexes
      where tablename = 'atendimentos' and indexname = 'idx_atendimentos_reprocessamento_pendente'
    `);
    assert.equal(indexResult.rowCount, 1, 'Índice idx_atendimentos_reprocessamento_pendente deve existir');
    const indexDef = indexResult.rows[0]?.indexdef ?? '';
    assert.match(indexDef, /concluido_em/i);
    assert.match(indexDef, /status.*=.*'concluido'/i);
    assert.match(indexDef, /reprocessamento_ignorado/i);
    assert.match(indexDef, /reprocessamento_tentativas.*<.*3/i);
    assert.match(indexDef, /concluido_em.*<.*'2026-08-19/i);
  } finally {
    await client.end();
  }
});

test('preparacao e execucao de migrations eh idempotente com a migration 0016', async () => {
  // Executa novamente prepareTestDatabase para verificar idempotência
  await assert.doesNotReject(async () => {
    await prepareTestDatabase();
  });
});

