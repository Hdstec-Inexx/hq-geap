import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import prepareTestDatabase from '../support/test-db.js';
import {
  findInconsistentConversationIdsQuery,
  reprocessConversation
} from '../../scripts/reprocessar-transcricoes.js';
import { normalizeTranscricao } from '@hq-geap/contracts/atendimentos';

const { Client } = pg;

type ReprocessamentoRastreamentoRow = {
  id?: string;
  reprocessamento_tentativas: number;
  reprocessamento_ignorado: boolean;
  reprocessamento_ultimo_erro: string | null;
};

async function createConnectedClient(): Promise<pg.Client> {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

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
  const client = await createConnectedClient();

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

test('indice parcial idx_atendimentos_reprocessamento_pendente e selecionado pelo query planner', async () => {
  await prepareTestDatabase();
  const client = await createConnectedClient();

  try {
    // Força uso de index scan pelo planner durante o teste de plano
    await client.query('set enable_seqscan = off');

    const explainResult = await client.query<{ 'QUERY PLAN': string }>(`
      explain
      select id, elevenlabs_conversation_id
      from atendimentos
      where status = 'concluido'
        and not reprocessamento_ignorado
        and reprocessamento_tentativas < 3
        and concluido_em < '2026-08-19'
      order by concluido_em asc
      limit 50
    `);

    const plan = explainResult.rows.map((r) => r['QUERY PLAN']).join('\n');
    assert.match(
      plan,
      /idx_atendimentos_reprocessamento_pendente/i,
      'Query planner deve usar o índice parcial idx_atendimentos_reprocessamento_pendente'
    );
  } finally {
    await client.query('set enable_seqscan = on').catch(() => {});
    await client.end();
  }
});

test('selecao em lote respeita corte temporal (< 19/08), ordenacao asc, limite de 50 e exclusao de ignorados/3 tentativas', async () => {
  await prepareTestDatabase();
  const client = await createConnectedClient();

  try {
    const agenteResult = await client.query<{ id: string }>(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Teste Selecao Lote', 'agent-selecao-lote-001')
      returning id
    `);
    const agenteVozId = agenteResult.rows[0]?.id;
    assert.ok(agenteVozId);

    const transcricaoInconsistente = JSON.stringify({
      historico: [
        { speaker: 'IA', message: 'Olá', tempo_segundos: 0, tempo_formatado: '00:00' },
        { speaker: 'Cliente', message: 'Ajuda', tempo_segundos: 0, tempo_formatado: '00:00' }
      ]
    });

    // Inserção de cenários diversos:
    // A1: Elegível antigo (15/08)
    await client.query(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        reprocessamento_tentativas, reprocessamento_ignorado
      ) values (
        $1, 'conv-elegivel-antigo', 'concluido', '2026-08-15 10:00:00+00', '2026-08-15 10:05:00+00', $2::jsonb,
        0, false
      )
    `, [agenteVozId, transcricaoInconsistente]);

    // A2: Elegível mais recente mas antes de 19/08 (18/08 23:59:00)
    await client.query(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        reprocessamento_tentativas, reprocessamento_ignorado
      ) values (
        $1, 'conv-elegivel-recente', 'concluido', '2026-08-18 23:50:00+00', '2026-08-18 23:59:00+00', $2::jsonb,
        1, false
      )
    `, [agenteVozId, transcricaoInconsistente]);

    // A3: Data corte exatamente 19/08 (19/08 00:00:00) -> DEVE SER EXCLUÍDO
    await client.query(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        reprocessamento_tentativas, reprocessamento_ignorado
      ) values (
        $1, 'conv-data-corte-19', 'concluido', '2026-08-19 00:00:00+00', '2026-08-19 00:05:00+00', $2::jsonb,
        0, false
      )
    `, [agenteVozId, transcricaoInconsistente]);

    // A4: Data após corte (20/08) -> DEVE SER EXCLUÍDO
    await client.query(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        reprocessamento_tentativas, reprocessamento_ignorado
      ) values (
        $1, 'conv-data-futura-20', 'concluido', '2026-08-20 14:00:00+00', '2026-08-20 14:05:00+00', $2::jsonb,
        0, false
      )
    `, [agenteVozId, transcricaoInconsistente]);

    // A5: Data válida (< 19/08), mas ignorado = true (descartado 404) -> DEVE SER EXCLUÍDO
    await client.query(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      ) values (
        $1, 'conv-ignorado-404', 'concluido', '2026-08-16 12:00:00+00', '2026-08-16 12:05:00+00', $2::jsonb,
        0, true, '404 Not Found'
      )
    `, [agenteVozId, transcricaoInconsistente]);

    // A6: Data válida (< 19/08), mas tentativas = 3 (limite de tolerância atingido) -> DEVE SER EXCLUÍDO
    await client.query(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      ) values (
        $1, 'conv-limite-3-tentativas', 'concluido', '2026-08-16 14:00:00+00', '2026-08-16 14:05:00+00', $2::jsonb,
        3, false, 'HTTP 500: Internal Server Error'
      )
    `, [agenteVozId, transcricaoInconsistente]);

    // Executa a query de seleção do lote no banco real
    const querySql = findInconsistentConversationIdsQuery();
    const result = await client.query<{ conversationId: string }>(querySql, [50]);

    const selectedIds = result.rows.map((r) => r.conversationId);

    // Valida que apenas os 2 elegíveis foram selecionados
    assert.deepEqual(selectedIds, ['conv-elegivel-antigo', 'conv-elegivel-recente']);

    // Garante a ordenação ASC por concluido_em (mais antigo primeiro)
    assert.equal(selectedIds[0], 'conv-elegivel-antigo');
    assert.equal(selectedIds[1], 'conv-elegivel-recente');
  } finally {
    await client.end();
  }
});

test('atendimento com resposta 404 da ElevenLabs e persistido com reprocessamento_ignorado e erro, sendo excluido do lote', async () => {
  await prepareTestDatabase();
  const client = await createConnectedClient();

  try {
    const agenteResult = await client.query<{ id: string }>(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Teste 404', 'agent-404-001')
      returning id
    `);
    const agenteVozId = agenteResult.rows[0]?.id;

    const transcricaoInconsistente = JSON.stringify({
      historico: [
        { speaker: 'IA', message: 'Olá', tempo_segundos: 0, tempo_formatado: '00:00' },
        { speaker: 'Cliente', message: 'Ajuda', tempo_segundos: 0, tempo_formatado: '00:00' }
      ]
    });

    const insertResult = await client.query<{ id: string }>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
      ) values (
        $1, 'conv-to-be-discarded-404', 'concluido', '2026-08-15 11:00:00+00', '2026-08-15 11:05:00+00', $2::jsonb,
        0, null, 0, false
      )
      returning id
    `, [agenteVozId, transcricaoInconsistente]);
    const atendimentoId = insertResult.rows[0]?.id;
    assert.ok(atendimentoId);

    // Cria uma avaliação existente para checar imutabilidade
    await client.query(`
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota, nota_qualidade, resumo_atendimento,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado
      )
      select $1, 'ia', p.id, 8.5, 8.5, 'Resumo original intacto',
        true, true, true, true, true, true, true, true, true
      from prompts_ia_avaliadora p
      where p.ativo
      limit 1
    `, [atendimentoId]);

    // Mock do fetch retornando 404
    const mockFetch404: typeof fetch = async () => {
      return new Response(JSON.stringify({ detail: 'Conversation not found' }), {
        status: 404,
        statusText: 'Not Found'
      });
    };

    // Executa reprocessamento com client real
    const outcome = await reprocessConversation(client, 'conv-to-be-discarded-404', {
      fetchFn: mockFetch404
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.ignored, true);
    assert.equal(outcome.error, '404 Not Found');

    // Verifica no banco se as colunas foram devidamente atualizadas
    const checkResult = await client.query<{
      reprocessamento_ignorado: boolean;
      reprocessamento_tentativas: number;
      reprocessamento_ultimo_erro: string;
    }>(`
      select reprocessamento_ignorado, reprocessamento_tentativas, reprocessamento_ultimo_erro
      from atendimentos
      where id = $1
    `, [atendimentoId]);

    const row = checkResult.rows[0];
    assert.ok(row);
    assert.equal(row.reprocessamento_ignorado, true);
    assert.equal(row.reprocessamento_tentativas, 0);
    assert.equal(row.reprocessamento_ultimo_erro, '404 Not Found');

    // Verifica que a avaliação da IA permanece 100% inalterada
    const avaliacaoResult = await client.query<{ nota_qualidade: string; resumo_atendimento: string }>(`
      select nota_qualidade, resumo_atendimento
      from avaliacoes
      where atendimento_id = $1
    `, [atendimentoId]);
    assert.equal(avaliacaoResult.rowCount, 1);
    assert.equal(Number(avaliacaoResult.rows[0]?.nota_qualidade), 8.5);
    assert.equal(avaliacaoResult.rows[0]?.resumo_atendimento, 'Resumo original intacto');

    // Verifica que buscas subsequentes do lote NÃO retornam esse atendimento
    const querySql = findInconsistentConversationIdsQuery();
    const batchResult = await client.query<{ conversationId: string }>(querySql, [50]);
    assert.equal(batchResult.rows.some((r) => r.conversationId === 'conv-to-be-discarded-404'), false);
  } finally {
    await client.end();
  }
});

test('falhas transitorias incrementam tentativas ate 3 e excluem do lote seguinte sem alterar avaliacoes', async () => {
  await prepareTestDatabase();
  const client = await createConnectedClient();

  try {
    const agenteResult = await client.query<{ id: string }>(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Teste 5xx', 'agent-5xx-001')
      returning id
    `);
    const agenteVozId = agenteResult.rows[0]?.id;

    const transcricaoInconsistente = JSON.stringify({
      historico: [
        { speaker: 'IA', message: 'Olá', tempo_segundos: 0, tempo_formatado: '00:00' },
        { speaker: 'Cliente', message: 'Ajuda', tempo_segundos: 0, tempo_formatado: '00:00' }
      ]
    });

    const insertResult = await client.query<{ id: string }>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em, transcricao,
        duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
      ) values (
        $1, 'conv-transient-fail', 'concluido', '2026-08-16 08:00:00+00', '2026-08-16 08:05:00+00', $2::jsonb,
        0, null, 0, false
      )
      returning id
    `, [agenteVozId, transcricaoInconsistente]);
    const atendimentoId = insertResult.rows[0]?.id;

    // Avaliação inicial
    await client.query(`
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota, nota_qualidade, resumo_atendimento,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado
      )
      select $1, 'ia', p.id, 9.0, 9.0, 'Avaliacao imutavel',
        true, true, true, true, true, true, true, true, true
      from prompts_ia_avaliadora p
      where p.ativo
      limit 1
    `, [atendimentoId]);

    const mockFetch500: typeof fetch = async () => {
      return new Response(JSON.stringify({ detail: 'Internal Server Error' }), {
        status: 500,
        statusText: 'Internal Server Error'
      });
    };

    // 1ª tentativa falha
    const res1 = await reprocessConversation(client, 'conv-transient-fail', { fetchFn: mockFetch500 });
    assert.equal(res1.success, false);

    const check1 = await client.query<{ reprocessamento_tentativas: number; reprocessamento_ignorado: boolean }>(`
      select reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      from atendimentos where id = $1
    `, [atendimentoId]);
    assert.equal(check1.rows[0]?.reprocessamento_tentativas, 1);
    assert.equal(check1.rows[0]?.reprocessamento_ignorado, false);

    // Ainda elegível no lote (tentativas = 1 < 3)
    const querySql = findInconsistentConversationIdsQuery();
    const batch1 = await client.query<{ conversationId: string }>(querySql, [50]);
    assert.equal(batch1.rows.some((r) => r.conversationId === 'conv-transient-fail'), true);

    // 2ª tentativa falha (timeout / erro de rede)
    const mockNetworkErr: typeof fetch = async () => {
      throw new Error('connect ETIMEDOUT 104.18.2.1:443');
    };
    const res2 = await reprocessConversation(client, 'conv-transient-fail', { fetchFn: mockNetworkErr });
    assert.equal(res2.success, false);

    const check2 = await client.query<{ reprocessamento_tentativas: number }>(`
      select reprocessamento_tentativas from atendimentos where id = $1
    `, [atendimentoId]);
    assert.equal(check2.rows[0]?.reprocessamento_tentativas, 2);

    // 3ª tentativa falha (HTTP 503)
    const mockFetch503: typeof fetch = async () => {
      return new Response(JSON.stringify({ detail: 'Service Unavailable' }), {
        status: 503,
        statusText: 'Service Unavailable'
      });
    };
    const res3 = await reprocessConversation(client, 'conv-transient-fail', { fetchFn: mockFetch503 });
    assert.equal(res3.success, false);

    const check3 = await client.query<{
      reprocessamento_tentativas: number;
      reprocessamento_ignorado: boolean;
      reprocessamento_ultimo_erro: string;
    }>(`
      select reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      from atendimentos where id = $1
    `, [atendimentoId]);
    assert.equal(check3.rows[0]?.reprocessamento_tentativas, 3);
    assert.equal(check3.rows[0]?.reprocessamento_ignorado, false);
    assert.match(check3.rows[0]?.reprocessamento_ultimo_erro ?? '', /503/i);

    // Agora que atingiu 3 tentativas, o lote NÃO deve mais retornar esse atendimento
    const batchAfter3 = await client.query<{ conversationId: string }>(querySql, [50]);
    assert.equal(batchAfter3.rows.some((r) => r.conversationId === 'conv-transient-fail'), false);

    // Avaliação permanece intocada
    const avaliacaoResult = await client.query<{ nota_qualidade: string }>(`
      select nota_qualidade from avaliacoes where atendimento_id = $1
    `, [atendimentoId]);
    assert.equal(Number(avaliacaoResult.rows[0]?.nota_qualidade), 9.0);
  } finally {
    await client.end();
  }
});

test('reprocessamento com sucesso atualiza transcricao, duracao, tme e reseta contadores no banco real preservando avaliacoes', async () => {
  await prepareTestDatabase();
  const client = await createConnectedClient();

  try {
    const agenteResult = await client.query<{ id: string }>(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Teste Sucesso', 'agent-sucesso-001')
      returning id
    `);
    const agenteVozId = agenteResult.rows[0]?.id;

    // Atendimento que já teve falhas prévias (tentativas = 2, erro anterior gravado)
    const insertResult = await client.query<{ id: string }>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
        transcricao, duracao_segundos, tme_segundos,
        reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      ) values (
        $1, 'conv-success-reset', 'concluido', '2026-08-17 15:00:00+00', '2026-08-17 15:02:00+00',
        '{"historico": [{"speaker": "IA", "tempo_segundos": 0}, {"speaker": "Cliente", "tempo_segundos": 0}]}'::jsonb,
        0, null,
        2, false, 'HTTP 500: Server Error'
      )
      returning id
    `, [agenteVozId]);
    const atendimentoId = insertResult.rows[0]?.id;

    // Snapshot de avaliação existente
    await client.query(`
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota, nota_qualidade, resumo_atendimento,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado
      )
      select $1, 'ia', p.id, 10.0, 10.0, 'Resumo perfeito',
        true, true, true, true, true, true, true, true, true
      from prompts_ia_avaliadora p
      where p.ativo
      limit 1
    `, [atendimentoId]);

    // Resposta bem sucedida da ElevenLabs com timestamps reais
    const mockFetchSuccess: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          conversation_id: 'conv-success-reset',
          status: 'done',
          metadata: {
            call_duration_secs: 88.4
          },
          transcript: [
            { role: 'agent', message: 'Olá, sou a Lívia da GEAP.', time_in_call_secs: 0 },
            { role: 'user', message: 'Gostaria de emitir boleto.', time_in_call_secs: 5 },
            { role: 'agent', message: 'Vou emitir para você agora.', time_in_call_secs: 12 }
          ]
        }),
        { status: 200 }
      );
    };

    const outcome = await reprocessConversation(client, 'conv-success-reset', {
      fetchFn: mockFetchSuccess
    });

    assert.equal(outcome.success, true);
    assert.equal(outcome.conversationId, 'conv-success-reset');

    // Valida persistência no Postgres
    const checkResult = await client.query<{
      transcricao: unknown;
      duracao_segundos: number;
      tme_segundos: number;
      reprocessamento_tentativas: number;
      reprocessamento_ignorado: boolean;
      reprocessamento_ultimo_erro: string | null;
    }>(`
      select transcricao, duracao_segundos, tme_segundos,
             reprocessamento_tentativas, reprocessamento_ignorado, reprocessamento_ultimo_erro
      from atendimentos
      where id = $1
    `, [atendimentoId]);

    const updatedRow = checkResult.rows[0];
    assert.ok(updatedRow);
    assert.equal(updatedRow.duracao_segundos, 88); // Math.round(88.4)
    assert.equal(updatedRow.tme_segundos, 7);      // 12 - 5 = 7s
    assert.equal(updatedRow.reprocessamento_tentativas, 0);
    assert.equal(updatedRow.reprocessamento_ignorado, false);
    assert.equal(updatedRow.reprocessamento_ultimo_erro, null);

    // Valida transcrição normalizada com timestamps reais por turno
    const normalized = normalizeTranscricao(updatedRow.transcricao);
    assert.equal(normalized.length, 3);
    assert.deepEqual(
      normalized.map((t) => ({ role: t.role, time: t.time_in_call_secs })),
      [
        { role: 'agent', time: 0 },
        { role: 'user', time: 5 },
        { role: 'agent', time: 12 }
      ]
    );

    // Valida preservação estrita da tabela avaliacoes
    const avaliacaoCheck = await client.query<{ nota_qualidade: string; resumo_atendimento: string }>(`
      select nota_qualidade, resumo_atendimento
      from avaliacoes
      where atendimento_id = $1
    `, [atendimentoId]);
    assert.equal(avaliacaoCheck.rowCount, 1);
    assert.equal(Number(avaliacaoCheck.rows[0]?.nota_qualidade), 10.0);
    assert.equal(avaliacaoCheck.rows[0]?.resumo_atendimento, 'Resumo perfeito');
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

