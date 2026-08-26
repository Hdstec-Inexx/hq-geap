import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTranscricao } from '@hq-geap/contracts/atendimentos';
import { buildApp } from '../../apps/api/src/app.js';
import {
  createConnectedClient,
  insertSnapshotAvaliacaoIa,
  withPreparedTestDatabase
} from '../support/test-db.js';

interface AvaliacaoDbRow {
  id: string;
  atendimento_id: string;
  autor: string;
  prompt_id: string;
  nota: string;
  nota_qualidade: string;
  resumo_atendimento: string;
  saudacao_e_intencao: boolean;
  solicitou_cpf: boolean;
  informou_protocolo_email: boolean;
  resolveu_solicitacao: boolean;
  validou_email_por_extenso: boolean;
  sem_diminutivos: boolean;
  encerramento_geap: boolean;
  uso_correto_ferramentas: boolean;
  falhas_identificadas: string[] | null;
  atendimento_aprovado: boolean;
  criado_em: Date;
  atualizado_em: Date | null;
}

test('ciclo completo de saneamento no boot da API: atualiza transcrições inconsistentes, calcula duração e TME e preserva avaliações no banco real', async () => {
  await withPreparedTestDatabase(async () => {
    const client = await createConnectedClient();

    let atendimentoId1 = '';
    let atendimentoId2 = '';

    try {
      // 1. Cria agente de voz
      const agenteResult = await client.query<{ id: string }>(`
        insert into agentes_voz (nome, elevenlabs_agent_id)
        values ('Lívia Saneamento Boot E2E', 'agent-saneamento-boot-e2e')
        returning id
      `);
      const agenteVozId = agenteResult.rows[0]?.id;
      assert.ok(agenteVozId);

      // 2. Cria 2 atendimentos com transcrições inconsistentes legadas
      const legacyInconsistent1 = JSON.stringify({
        historico: [
          { speaker: 'IA', message: 'Olá, sou a Lívia.', tempo_segundos: 0, tempo_formatado: '00:00' },
          { speaker: 'Cliente', message: 'Segunda via boleto.', tempo_segundos: 0, tempo_formatado: '00:00' },
          { speaker: 'IA', message: 'Localizando documento.', tempo_segundos: 0, tempo_formatado: '00:00' }
        ]
      });

      const res1 = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-boot-001', 'concluido', '2026-08-10 10:00:00+00', '2026-08-10 10:01:00+00',
          $2::jsonb, 0, null, 0, false
        )
        returning id
      `, [agenteVozId, legacyInconsistent1]);
      atendimentoId1 = res1.rows[0]?.id ?? '';
      assert.ok(atendimentoId1);

      const legacyInconsistent2 = JSON.stringify([
        { role: 'agent', message: 'Central GEAP, bom dia!', time_in_call_secs: 0 },
        { role: 'user', message: 'Quero consultar clínicas.', time_in_call_secs: 0 },
        { role: 'agent', message: 'Vou pesquisar a rede.', time_in_call_secs: 0 }
      ]);

      const res2 = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-boot-002', 'concluido', '2026-08-12 14:00:00+00', '2026-08-12 14:02:00+00',
          $2::jsonb, 0, null, 0, false
        )
        returning id
      `, [agenteVozId, legacyInconsistent2]);
      atendimentoId2 = res2.rows[0]?.id ?? '';
      assert.ok(atendimentoId2);

      // 3. Cria avaliações existentes da IA para ambos os atendimentos
      await insertSnapshotAvaliacaoIa(client, atendimentoId1, 9.5, 'Resumo do atendimento 1');
      await insertSnapshotAvaliacaoIa(client, atendimentoId2, 10.0, 'Resumo do atendimento 2');

      // 4. Captura snapshots profundos das avaliações antes do reprocessamento
      const avaliacoesBeforeResult = await client.query<AvaliacaoDbRow>(`
        select * from avaliacoes order by atendimento_id asc
      `);
      const avaliacoesSnapshotBefore = JSON.parse(JSON.stringify(avaliacoesBeforeResult.rows));
      const totalAvaliacoesBefore = avaliacoesBeforeResult.rowCount;
      assert.equal(totalAvaliacoesBefore, 2);

      // 5. Mock da API ElevenLabs com respostas detalhadas e cronológicas
      const mockElevenLabsFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes('conv-e2e-boot-001')) {
          return new Response(
            JSON.stringify({
              conversation_id: 'conv-e2e-boot-001',
              status: 'done',
              transcript: [
                { role: 'agent', message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
                { role: 'user', message: 'Segunda via boleto.', time_in_call_secs: 4 },
                { role: 'agent', message: 'Localizando documento.', time_in_call_secs: 11 },
                { role: 'user', message: 'Obrigado!', time_in_call_secs: 20 },
                { role: 'agent', message: 'Boleto enviado com sucesso!', time_in_call_secs: 26 }
              ],
              metadata: {
                call_duration_secs: 42.4
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        if (url.includes('conv-e2e-boot-002')) {
          return new Response(
            JSON.stringify({
              conversation_id: 'conv-e2e-boot-002',
              status: 'done',
              transcript: [
                { role: 'agent', message: 'Central GEAP, bom dia!', time_in_call_secs: 0 },
                { role: 'user', message: 'Quero consultar clínicas.', time_in_call_secs: 6 },
                {
                  role: 'agent',
                  message: '',
                  time_in_call_secs: 10,
                  tool_calls: [{ tool_name: 'consultar_rede', tool_call_id: 'c1', tool_has_been_called: true }]
                },
                {
                  role: 'agent',
                  message: 'Encontrei 3 clínicas próximas.',
                  time_in_call_secs: 19,
                  tool_results: [{ tool_call_id: 'c1', tool_name: 'consultar_rede', is_error: false }]
                }
              ],
              metadata: {
                call_duration_secs: 65.8
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
      };

      // 6. Inicializa a aplicação Fastify com o plugin de reprocessamento habilitado
      const app = await buildApp({
        reprocessamento: {
          enabled: true,
          runImmediately: true,
          intervalMinutes: 10,
          fetchFn: mockElevenLabsFetch
        }
      });

      await app.ready();

    // Aguarda o ciclo disparado em background pelo onReady concluir ambos os atendimentos
    const startWait = Date.now();
    let reprocessedInDb = false;
    while (!reprocessedInDb && Date.now() - startWait < 10000) {
      const check = await client.query<{ id: string; duracao_segundos: number | null }>(`
        select id, duracao_segundos from atendimentos where id in ($1, $2)
      `, [atendimentoId1, atendimentoId2]);
      const r1 = check.rows.find((r) => r.id === atendimentoId1);
      const r2 = check.rows.find((r) => r.id === atendimentoId2);
      if (r1?.duracao_segundos === 42 && r2?.duracao_segundos === 66) {
        reprocessedInDb = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.equal(reprocessedInDb, true, 'O ciclo de reprocessamento imediato deve atualizar todos os atendimentos do lote no banco');

      // 7. Validação do Atendimento 1 no PostgreSQL
      const check1 = await client.query<{
        duracao_segundos: number;
        tme_segundos: number;
        transcricao: unknown;
        reprocessamento_tentativas: number;
        reprocessamento_ignorado: boolean;
        reprocessamento_ultimo_erro: string | null;
        atualizado_em: Date | null;
      }>(`
        select duracao_segundos, tme_segundos, transcricao, reprocessamento_tentativas,
               reprocessamento_ignorado, reprocessamento_ultimo_erro, atualizado_em
        from atendimentos
        where id = $1
      `, [atendimentoId1]);

      const row1 = check1.rows[0]!;
      assert.equal(row1.duracao_segundos, 42); // Math.round(42.4)
      assert.equal(row1.tme_segundos, 7);      // 11 - 4 = 7s
      assert.equal(row1.reprocessamento_tentativas, 0);
      assert.equal(row1.reprocessamento_ignorado, false);
      assert.equal(row1.reprocessamento_ultimo_erro, null);
      assert.ok(row1.atualizado_em instanceof Date);

      const normalized1 = normalizeTranscricao(row1.transcricao);
      assert.equal(normalized1.length, 5);
      assert.deepEqual(
        normalized1.map((t) => ({ role: t.role, time: t.time_in_call_secs, message: t.message })),
        [
          { role: 'agent', time: 0, message: 'Olá, sou a Lívia.' },
          { role: 'user', time: 4, message: 'Segunda via boleto.' },
          { role: 'agent', time: 11, message: 'Localizando documento.' },
          { role: 'user', time: 20, message: 'Obrigado!' },
          { role: 'agent', time: 26, message: 'Boleto enviado com sucesso!' }
        ]
      );

      // 8. Validação do Atendimento 2 no PostgreSQL
      const check2 = await client.query<{
        duracao_segundos: number;
        tme_segundos: number;
        transcricao: unknown;
        reprocessamento_tentativas: number;
        reprocessamento_ignorado: boolean;
        reprocessamento_ultimo_erro: string | null;
      }>(`
        select duracao_segundos, tme_segundos, transcricao, reprocessamento_tentativas,
               reprocessamento_ignorado, reprocessamento_ultimo_erro
        from atendimentos
        where id = $1
      `, [atendimentoId2]);

      const row2 = check2.rows[0]!;
      assert.equal(row2.duracao_segundos, 66); // Math.round(65.8)
      assert.equal(row2.tme_segundos, 13);     // 19 - 6 = 13s
      assert.equal(row2.reprocessamento_tentativas, 0);
      assert.equal(row2.reprocessamento_ignorado, false);
      assert.equal(row2.reprocessamento_ultimo_erro, null);

      const normalized2 = normalizeTranscricao(row2.transcricao);
      assert.equal(normalized2.length, 4);
      assert.equal(normalized2[0]?.time_in_call_secs, 0);
      assert.equal(normalized2[1]?.time_in_call_secs, 6);
      assert.equal(normalized2[2]?.time_in_call_secs, 10);
      assert.equal(normalized2[3]?.time_in_call_secs, 19);

      // 9. Verificação de Imutabilidade das Avaliações (ADR-0004 e ADR-0016)
      const avaliacoesAfterResult = await client.query<AvaliacaoDbRow>(`
        select * from avaliacoes order by atendimento_id asc
      `);
      assert.equal(avaliacoesAfterResult.rowCount, totalAvaliacoesBefore);
      const avaliacoesSnapshotAfter = JSON.parse(JSON.stringify(avaliacoesAfterResult.rows));

      assert.deepEqual(
        avaliacoesSnapshotAfter,
        avaliacoesSnapshotBefore,
        'A tabela avaliações deve permanecer estritamente idêntica após o reprocessamento de transcrições'
      );

      // 10. Encerramento gracioso
      await app.close();
    } finally {
      await client.end();
    }
  });
});

test('concorrência entre instâncias Fastify: advisory lock impede que segunda réplica reprocesse simultaneamente o mesmo lote', async () => {
  await withPreparedTestDatabase(async () => {
    const client = await createConnectedClient();

    try {
      const agenteResult = await client.query<{ id: string }>(`
        insert into agentes_voz (nome, elevenlabs_agent_id)
        values ('Lívia Concorrência E2E', 'agent-concorrencia-e2e')
        returning id
      `);
      const agenteVozId = agenteResult.rows[0]?.id;

      await client.query(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-lock-001', 'concluido', '2026-08-10 09:00:00+00', '2026-08-10 09:05:00+00',
          '[]'::jsonb, 0, null, 0, false
        )
      `, [agenteVozId]);

      let app1ReprocessRan = false;
      let app2ReprocessRan = false;

      let signalApp1LockAcquired!: () => void;
      const app1LockAcquired = new Promise<void>((resolve) => {
        signalApp1LockAcquired = resolve;
      });

      let signalApp1CanFinish!: () => void;
      const app1CanFinish = new Promise<void>((resolve) => {
        signalApp1CanFinish = resolve;
      });

      // Instância 1 da API Fastify
      const app1 = await buildApp({
        reprocessamento: {
          enabled: false,
          reprocessFn: async () => {
            app1ReprocessRan = true;
            signalApp1LockAcquired();
            await app1CanFinish;
            return { processed: 1, success: 1, failed: 0 };
          }
        }
      });

      // Instância 2 da API Fastify
      const app2 = await buildApp({
        reprocessamento: {
          enabled: false,
          reprocessFn: async () => {
            app2ReprocessRan = true;
            return { processed: 1, success: 1, failed: 0 };
          }
        }
      });

      await app1.ready();
      await app2.ready();

      assert.ok(app1.reprocessamentoTranscricao);
      assert.ok(app2.reprocessamentoTranscricao);

      // Dispara o ciclo na App 1
      const app1CyclePromise = app1.reprocessamentoTranscricao.runCycle();

      // Aguarda App 1 adquirir o lock consultivo no Postgres
      await app1LockAcquired;

      // Dispara o ciclo na App 2 concorrentemente enquanto App 1 retém o lock
      const res2 = await app2.reprocessamentoTranscricao.runCycle();

      // Libera App 1 para concluir a transação
      signalApp1CanFinish();
      const res1 = await app1CyclePromise;

      // Valida que App 1 obteve o lock e executou
      assert.equal(res1.locked, true, 'App 1 deve adquirir o lock consultivo');
      assert.equal(res1.executed, true, 'App 1 deve executar o lote com sucesso');
      assert.equal(res1.processed, 1);
      assert.equal(app1ReprocessRan, true);

      // Valida que App 2 detectou o lock consultivo ocupado e ignorou
      assert.equal(res2.locked, false, 'App 2 não deve adquirir o lock concorrente');
      assert.equal(res2.executed, false, 'App 2 deve ignorar a execução concorrente');
      assert.equal(res2.processed, 0);
      assert.equal(app2ReprocessRan, false, 'App 2 não deve invocar a lógica de reprocessamento');

      await app1.close();
      await app2.close();
    } finally {
      await client.end();
    }
  });
});

test('critérios de elegibilidade e corte temporal: lote seleciona apenas atendimentos elegíveis e ignora pós-18/08, 404 descartados, limite de falhas e consistentes', async () => {
  await withPreparedTestDatabase(async () => {
    const client = await createConnectedClient();

    try {
      const agenteResult = await client.query<{ id: string }>(`
        insert into agentes_voz (nome, elevenlabs_agent_id)
        values ('Lívia Elegibilidade E2E', 'agent-elegibilidade-e2e')
        returning id
      `);
      const agenteVozId = agenteResult.rows[0]?.id;

      const inconsistentTranscript = JSON.stringify({
        historico: [
          { speaker: 'IA', message: 'Olá', tempo_segundos: 0, tempo_formatado: '00:00' },
          { speaker: 'Cliente', message: 'Preciso de boleto', tempo_segundos: 0, tempo_formatado: '00:00' }
        ]
      });

      const consistentTranscript = JSON.stringify({
        historico: [
          { speaker: 'IA', message: 'Olá', tempo_segundos: 0, tempo_formatado: '00:00' },
          { speaker: 'Cliente', message: 'Preciso de boleto', tempo_segundos: 5, tempo_formatado: '00:05' },
          { speaker: 'IA', message: 'Aqui está seu boleto', tempo_segundos: 14, tempo_formatado: '00:14' }
        ]
      });

      // 1. Elegível 1 (concluído em 2026-08-05)
      const elegivelAntigoResult = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-elegivel-001', 'concluido', '2026-08-05 10:00:00+00', '2026-08-05 10:05:00+00',
          $2::jsonb, 0, null, 0, false
        ) returning id
      `, [agenteVozId, inconsistentTranscript]);

      // 2. Elegível 2 (concluído em 2026-08-16, com 1 tentativa prévia)
      const elegivelRecenteResult = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-elegivel-002', 'concluido', '2026-08-16 12:00:00+00', '2026-08-16 12:05:00+00',
          $2::jsonb, 0, null, 1, false
        ) returning id
      `, [agenteVozId, inconsistentTranscript]);

      // 3. Inelegível: Após a data de corte (concluído em 2026-08-20 >= 2026-08-19)
      const posCorteResult = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-pos-corte', 'concluido', '2026-08-20 10:00:00+00', '2026-08-20 10:05:00+00',
          $2::jsonb, 0, null, 0, false
        ) returning id
      `, [agenteVozId, inconsistentTranscript]);

      // 4. Inelegível: Descarte 404 anterior (reprocessamento_ignorado = true)
      const descartado404Result = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado,
          reprocessamento_ultimo_erro
        ) values (
          $1, 'conv-e2e-descartado-404', 'concluido', '2026-08-10 10:00:00+00', '2026-08-10 10:05:00+00',
          $2::jsonb, 0, null, 0, true, '404 Not Found'
        ) returning id
      `, [agenteVozId, inconsistentTranscript]);

      // 5. Inelegível: Limite de 3 tentativas atingido
      const maxTentativasResult = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado,
          reprocessamento_ultimo_erro
        ) values (
          $1, 'conv-e2e-max-tentativas', 'concluido', '2026-08-10 10:00:00+00', '2026-08-10 10:05:00+00',
          $2::jsonb, 0, null, 3, false, 'HTTP 500: Internal Server Error'
        ) returning id
      `, [agenteVozId, inconsistentTranscript]);

      // 6. Inelegível: Status não concluído ('em_andamento')
      const emAndamentoResult = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-em-andamento', 'em_andamento', '2026-08-10 10:00:00+00', null,
          $2::jsonb, null, null, 0, false
        ) returning id
      `, [agenteVozId, inconsistentTranscript]);

      // 7. Inelegível: Transcrição já consistente
      const jaConsistenteResult = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-e2e-ja-consistente', 'concluido', '2026-08-10 10:00:00+00', '2026-08-10 10:05:00+00',
          $2::jsonb, 30, 9, 0, false
        ) returning id
      `, [agenteVozId, consistentTranscript]);

      const allInsertedIds = [
        elegivelAntigoResult.rows[0]!.id,
        elegivelRecenteResult.rows[0]!.id,
        posCorteResult.rows[0]!.id,
        descartado404Result.rows[0]!.id,
        maxTentativasResult.rows[0]!.id,
        emAndamentoResult.rows[0]!.id,
        jaConsistenteResult.rows[0]!.id
      ];

      // Cria avaliação para cada um dos atendimentos
      for (const id of allInsertedIds) {
        await insertSnapshotAvaliacaoIa(client, id, 9.0, `Avaliação para ${id}`);
      }

      const avaliacoesBefore = await client.query<AvaliacaoDbRow>(`select * from avaliacoes`);
      const avaliacoesSnapshotBefore = JSON.parse(JSON.stringify(avaliacoesBefore.rows));

      const processedConversations: string[] = [];
      const mockFetch: typeof fetch = async (input) => {
        const url = String(input);
        const conversationId = url.split('/').pop()!;
        processedConversations.push(conversationId);

        return new Response(
          JSON.stringify({
            conversation_id: conversationId,
            status: 'done',
            transcript: [
              { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
              { role: 'user', message: 'Preciso de boleto', time_in_call_secs: 5 },
              { role: 'agent', message: 'Aqui está seu boleto', time_in_call_secs: 12 }
            ],
            metadata: { call_duration_secs: 45 }
          }),
          { status: 200 }
        );
      };

      const app = await buildApp({
        reprocessamento: {
          enabled: false,
          fetchFn: mockFetch
        }
      });

      await app.ready();

      // Executa o ciclo de reprocessamento
      const result = await app.reprocessamentoTranscricao!.runCycle();

      assert.equal(result.executed, true);
      assert.equal(result.locked, true);
      assert.equal(result.processed, 2, 'Apenas os 2 atendimentos elegíveis devem ser processados');
      assert.equal(result.success, 2);
      assert.equal(result.failed, 0);

      // Valida que apenas os 2 IDs elegíveis foram requisitados
      assert.deepEqual(processedConversations, [
        'conv-e2e-elegivel-001',
        'conv-e2e-elegivel-002'
      ]);

      // Valida que os inelegíveis não sofreram nenhuma alteração
      const posCorteCheck = await client.query<{ duracao_segundos: number }>(`
        select duracao_segundos from atendimentos where id = $1
      `, [posCorteResult.rows[0]!.id]);
      assert.equal(posCorteCheck.rows[0]?.duracao_segundos, 0, 'Atendimento pós-corte não deve ser alterado');

      const descartado404Check = await client.query<{ reprocessamento_ignorado: boolean }>(`
        select reprocessamento_ignorado from atendimentos where id = $1
      `, [descartado404Result.rows[0]!.id]);
      assert.equal(descartado404Check.rows[0]?.reprocessamento_ignorado, true);

      const maxTentativasCheck = await client.query<{ reprocessamento_tentativas: number }>(`
        select reprocessamento_tentativas from atendimentos where id = $1
      `, [maxTentativasResult.rows[0]!.id]);
      assert.equal(maxTentativasCheck.rows[0]?.reprocessamento_tentativas, 3);

      // Valida imutabilidade de todas as avaliações
      const avaliacoesAfter = await client.query<AvaliacaoDbRow>(`select * from avaliacoes`);
      assert.deepEqual(
        JSON.parse(JSON.stringify(avaliacoesAfter.rows)),
        avaliacoesSnapshotBefore,
        'Nenhuma avaliação deve ser alterada ou criada'
      );

      await app.close();
    } finally {
      await client.end();
    }
  });
});

test('isolamento transacional e tolerância a falhas no lote: trata 200, 404 e 500 de forma independente no banco real', async () => {
  await withPreparedTestDatabase(async () => {
    const client = await createConnectedClient();

    try {
      const agenteResult = await client.query<{ id: string }>(`
        insert into agentes_voz (nome, elevenlabs_agent_id)
        values ('Lívia Tolerância E2E', 'agent-tolerancia-e2e')
        returning id
      `);
      const agenteVozId = agenteResult.rows[0]?.id;

      const inconsistent = JSON.stringify([
        { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
        { role: 'user', message: 'Ajuda', time_in_call_secs: 0 }
      ]);

      // 1. Atendimento que responderá 200 OK
      const resSuccess = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-mix-ok-001', 'concluido', '2026-08-10 10:00:00+00', '2026-08-10 10:05:00+00',
          $2::jsonb, 0, null, 0, false
        ) returning id
      `, [agenteVozId, inconsistent]);

      // 2. Atendimento que responderá 404 (deve ser descartado imediatamente com reprocessamento_ignorado = true)
      const res404 = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-mix-404-002', 'concluido', '2026-08-11 11:00:00+00', '2026-08-11 11:05:00+00',
          $2::jsonb, 0, null, 0, false
        ) returning id
      `, [agenteVozId, inconsistent]);

      // 3. Atendimento que responderá 500 (deve incrementar tentativas para 1)
      const res500 = await client.query<{ id: string }>(`
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
          transcricao, duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        ) values (
          $1, 'conv-mix-500-003', 'concluido', '2026-08-12 12:00:00+00', '2026-08-12 12:05:00+00',
          $2::jsonb, 0, null, 0, false
        ) returning id
      `, [agenteVozId, inconsistent]);

      await insertSnapshotAvaliacaoIa(client, resSuccess.rows[0]!.id, 10.0, 'Sucesso');
      await insertSnapshotAvaliacaoIa(client, res404.rows[0]!.id, 8.0, 'Descarte');
      await insertSnapshotAvaliacaoIa(client, res500.rows[0]!.id, 7.5, 'Erro transitório');

      const avaliacoesSnapshotBefore = JSON.parse(
        JSON.stringify((await client.query<AvaliacaoDbRow>(`select * from avaliacoes order by id asc`)).rows)
      );

      let round500Succeeds = false;

      const mockFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes('conv-mix-ok-001')) {
          return new Response(
            JSON.stringify({
              conversation_id: 'conv-mix-ok-001',
              status: 'done',
              transcript: [
                { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
                { role: 'user', message: 'Ajuda', time_in_call_secs: 4 },
                { role: 'agent', message: 'Resolvido!', time_in_call_secs: 10 }
              ],
              metadata: { call_duration_secs: 30 }
            }),
            { status: 200 }
          );
        }

        if (url.includes('conv-mix-404-002')) {
          return new Response(JSON.stringify({ detail: 'Conversation not found' }), {
            status: 404,
            statusText: 'Not Found'
          });
        }

        if (url.includes('conv-mix-500-003')) {
          if (!round500Succeeds) {
            return new Response(JSON.stringify({ detail: 'Server Error' }), {
              status: 500,
              statusText: 'Internal Server Error'
            });
          }
          return new Response(
            JSON.stringify({
              conversation_id: 'conv-mix-500-003',
              status: 'done',
              transcript: [
                { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
                { role: 'user', message: 'Ajuda', time_in_call_secs: 5 },
                { role: 'agent', message: 'Atendido!', time_in_call_secs: 14 }
              ],
              metadata: { call_duration_secs: 40 }
            }),
            { status: 200 }
          );
        }

        return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
      };

      const app = await buildApp({
        reprocessamento: {
          enabled: false,
          fetchFn: mockFetch
        }
      });

      await app.ready();

      // Rodada 1: Executa o lote misto
      const round1Result = await app.reprocessamentoTranscricao!.runCycle();

      assert.equal(round1Result.processed, 3);
      assert.equal(round1Result.success, 1);
      assert.equal(round1Result.failed, 2);

      // Valida conv-mix-ok-001 (atualizado)
      const checkOk = await client.query<{
        duracao_segundos: number;
        tme_segundos: number;
        reprocessamento_tentativas: number;
        reprocessamento_ignorado: boolean;
      }>(`
        select duracao_segundos, tme_segundos, reprocessamento_tentativas, reprocessamento_ignorado
        from atendimentos where id = $1
      `, [resSuccess.rows[0]!.id]);
      assert.equal(checkOk.rows[0]?.duracao_segundos, 30);
      assert.equal(checkOk.rows[0]?.tme_segundos, 6); // 10 - 4 = 6
      assert.equal(checkOk.rows[0]?.reprocessamento_tentativas, 0);
      assert.equal(checkOk.rows[0]?.reprocessamento_ignorado, false);

      // Valida conv-mix-404-002 (descartado 404)
      const check404 = await client.query<{
        reprocessamento_ignorado: boolean;
        reprocessamento_tentativas: number;
        reprocessamento_ultimo_erro: string;
      }>(`
        select reprocessamento_ignorado, reprocessamento_tentativas, reprocessamento_ultimo_erro
        from atendimentos where id = $1
      `, [res404.rows[0]!.id]);
      assert.equal(check404.rows[0]?.reprocessamento_ignorado, true);
      assert.equal(check404.rows[0]?.reprocessamento_ultimo_erro, '404 Not Found');

      // Valida conv-mix-500-003 (falha transitória: tentativas = 1)
      const check500 = await client.query<{
        reprocessamento_ignorado: boolean;
        reprocessamento_tentativas: number;
        reprocessamento_ultimo_erro: string;
      }>(`
        select reprocessamento_ignorado, reprocessamento_tentativas, reprocessamento_ultimo_erro
        from atendimentos where id = $1
      `, [res500.rows[0]!.id]);
      assert.equal(check500.rows[0]?.reprocessamento_ignorado, false);
      assert.equal(check500.rows[0]?.reprocessamento_tentativas, 1);
      assert.match(check500.rows[0]?.reprocessamento_ultimo_erro ?? '', /500/i);

      // Rodada 2: Apenas conv-mix-500-003 deve ser selecionado (ok foi saneado e 404 foi ignorado)
      round500Succeeds = true;
      const round2Result = await app.reprocessamentoTranscricao!.runCycle();

      assert.equal(round2Result.processed, 1, 'Rodada 2 deve selecionar apenas o item restante');
      assert.equal(round2Result.success, 1);
      assert.equal(round2Result.failed, 0);

      const check500AfterSuccess = await client.query<{
        duracao_segundos: number;
        tme_segundos: number;
        reprocessamento_tentativas: number;
        reprocessamento_ignorado: boolean;
        reprocessamento_ultimo_erro: string | null;
      }>(`
        select duracao_segundos, tme_segundos, reprocessamento_tentativas,
               reprocessamento_ignorado, reprocessamento_ultimo_erro
        from atendimentos where id = $1
      `, [res500.rows[0]!.id]);
      assert.equal(check500AfterSuccess.rows[0]?.duracao_segundos, 40);
      assert.equal(check500AfterSuccess.rows[0]?.tme_segundos, 9); // 14 - 5 = 9
      assert.equal(check500AfterSuccess.rows[0]?.reprocessamento_tentativas, 0, 'Tentativas devem ser resetadas para 0');
      assert.equal(check500AfterSuccess.rows[0]?.reprocessamento_ignorado, false);
      assert.equal(check500AfterSuccess.rows[0]?.reprocessamento_ultimo_erro, null);

      // Rodada 3: Não há mais itens pendentes
      const round3Result = await app.reprocessamentoTranscricao!.runCycle();
      assert.equal(round3Result.processed, 0);

      // Imutabilidade estrita das avaliações
      const avaliacoesAfter = await client.query<AvaliacaoDbRow>(`select * from avaliacoes order by id asc`);
      assert.deepEqual(
        JSON.parse(JSON.stringify(avaliacoesAfter.rows)),
        avaliacoesSnapshotBefore,
        'Avaliações devem permanecer estritamente inalteradas em todas as rodadas'
      );

      await app.close();
    } finally {
      await client.end();
    }
  });
});
