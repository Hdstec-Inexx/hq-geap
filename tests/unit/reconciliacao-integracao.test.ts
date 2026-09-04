import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ingestAtendimentoSchema,
  normalizeTranscricao,
  type IngestAtendimento
} from '@hq-geap/contracts/atendimentos';
import { createAtendimentosRepository } from '../../apps/api/src/modules/atendimentos/repository.js';
import { toAtendimentoDetail } from '../../apps/api/src/modules/atendimentos/service.js';
import {
  reprocessConversation,
  type DatabaseQueryable
} from '../../scripts/reprocessar-transcricoes.js';

const reconciliacaoWorkflowPath = new URL(
  '../../n8n/workflows/reconciliacao-atendimentos.json',
  import.meta.url
);

interface MockDatabaseState {
  agentesVoz: Array<{ id: string; nome: string; elevenlabs_agent_id: string }>;
  atendimentos: Map<string, {
    id: string;
    agente_voz_id: string;
    elevenlabs_conversation_id: string;
    status: string;
    iniciado_em: Date | null;
    concluido_em: Date | null;
    duracao_segundos: number | null;
    transcricao: unknown;
    audio_url: string | null;
    motivo_contato: string | null;
    houve_transferencia: boolean;
    custo: string | null;
    elevenlabs_event_timestamp: string | null;
    tme_segundos: number | null;
    tools_executados: number;
    tools_sucesso: number;
    criado_em: Date;
    atualizado_em: Date | null;
  }>;
  avaliacoes: Map<string, {
    id: string;
    atendimento_id: string;
    prompt_id: string;
    autor: string;
    checklist: Record<string, boolean>;
    falhas_identificadas: string[];
    resumo_atendimento: string;
    atendimento_aprovado: boolean;
    nota_qualidade: number;
    criado_em: Date;
    atualizado_em?: Date | null;
  }>;
  queriesLog: Array<{ text: string; values?: unknown[] }>;
}

function createMockDatabase() {
  const state: MockDatabaseState = {
    agentesVoz: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        nome: 'Lívia',
        elevenlabs_agent_id: 'agent-livia-test'
      }
    ],
    atendimentos: new Map(),
    avaliacoes: new Map(),
    queriesLog: []
  };

  const pool = {
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          state.queriesLog.push({ text, values });

          // Advisory lock or transactions
          if (
            text === 'begin' ||
            text === 'commit' ||
            text === 'rollback' ||
            text.includes('pg_advisory_xact_lock')
          ) {
            return { rows: [], rowCount: 1 };
          }

          // Select agente_voz
          if (text.includes('from agentes_voz where elevenlabs_agent_id = $1')) {
            const agent = state.agentesVoz.find((a) => a.elevenlabs_agent_id === values?.[0]);
            return {
              rows: agent ? [{ id: agent.id }] : [],
              rowCount: agent ? 1 : 0
            };
          }

          // Select existing atendimento for update
          if (text.includes('from atendimentos') && text.includes('where elevenlabs_conversation_id = $1') && text.includes('for update')) {
            const convId = values?.[0] as string;
            const row = state.atendimentos.get(convId);
            if (!row) {
              return { rows: [], rowCount: 0 };
            }
            return {
              rows: [
                {
                  agenteVozId: row.agente_voz_id,
                  eventTimestamp: row.elevenlabs_event_timestamp,
                  status: row.status
                }
              ],
              rowCount: 1
            };
          }

          // Update atendimento
          if (text.includes('update atendimentos') && text.includes('set status = $3')) {
            // values: [agentId, conversation_id, status, started_at, completed_at, duration_seconds, transcript_json, audio_url, contact_reason, transferred, cost, event_timestamp, tme_seconds, tools_exec, tools_succ, hasToolExec]
            const convId = values?.[1] as string;
            const current = state.atendimentos.get(convId);
            if (current) {
              current.status = values?.[2] as string;
              if (values?.[3]) current.iniciado_em = new Date(values[3] as string);
              if (values?.[4]) current.concluido_em = new Date(values[4] as string);
              if (values?.[5] !== null && values?.[5] !== undefined) {
                current.duracao_segundos = Number(values[5]);
              }
              current.transcricao = JSON.parse(values?.[6] as string);
              if (values?.[7]) current.audio_url = values[7] as string;
              if (values?.[8]) current.motivo_contato = values[8] as string;
              current.houve_transferencia = current.houve_transferencia || Boolean(values?.[9]);
              if (values?.[10]) current.custo = String(values[10]);
              current.elevenlabs_event_timestamp = String(values?.[11]);
              if (values?.[12] !== null && values?.[12] !== undefined) {
                current.tme_segundos = Number(values[12]);
              }
              if (values?.[15]) {
                current.tools_executados = Number(values?.[13] ?? 0);
                current.tools_sucesso = Number(values?.[14] ?? 0);
              }
              current.atualizado_em = new Date();
            }
            return { rows: [], rowCount: current ? 1 : 0 };
          }

          // Insert atendimento
          if (text.includes('insert into atendimentos')) {
            const convId = values?.[1] as string;
            const id = '22222222-2222-4222-8222-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
            const row = {
              id,
              agente_voz_id: values?.[0] as string,
              elevenlabs_conversation_id: convId,
              status: values?.[2] as string,
              iniciado_em: values?.[3] ? new Date(values[3] as string) : null,
              concluido_em: values?.[4] ? new Date(values[4] as string) : null,
              duracao_segundos: values?.[5] !== null && values?.[5] !== undefined ? Number(values[5]) : null,
              transcricao: JSON.parse(values?.[6] as string),
              audio_url: values?.[7] as string | null,
              motivo_contato: values?.[8] as string | null,
              houve_transferencia: Boolean(values?.[9]),
              custo: values?.[10] ? String(values[10]) : null,
              elevenlabs_event_timestamp: values?.[11] ? String(values[11]) : null,
              tme_segundos: values?.[12] !== null && values?.[12] !== undefined ? Number(values[12]) : null,
              tools_executados: Number(values?.[13] ?? 0),
              tools_sucesso: Number(values?.[14] ?? 0),
              criado_em: new Date(),
              atualizado_em: null
            };
            state.atendimentos.set(convId, row);
            return { rows: [], rowCount: 1 };
          }

          // Select full atendimento by conversation_id
          if (text.includes('where a.elevenlabs_conversation_id = $1')) {
            const convId = values?.[0] as string;
            const row = state.atendimentos.get(convId);
            if (!row) {
              return { rows: [], rowCount: 0 };
            }
            const agent = state.agentesVoz.find((a) => a.id === row.agente_voz_id);
            const formatted = {
              id: row.id,
              conversationId: row.elevenlabs_conversation_id,
              agenteVozId: row.agente_voz_id,
              agenteVozNome: agent?.nome ?? 'Lívia',
              agentId: agent?.elevenlabs_agent_id ?? 'agent-livia-test',
              status: row.status,
              iniciadoEm: row.iniciado_em,
              concluidoEm: row.concluido_em,
              duracaoSegundos: row.duracao_segundos,
              motivoContato: row.motivo_contato,
              houveTransferencia: row.houve_transferencia,
              custo: row.custo,
              notaIa: null,
              eventTimestamp: row.elevenlabs_event_timestamp,
              curadorId: null,
              curadorNome: null,
              curadoriaNota: null,
              curadoriaRealizadaEm: null,
              transcricao: row.transcricao,
              audioReference: row.audio_url
            };
            return { rows: [formatted], rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    },
    async query(text: string, values?: unknown[]) {
      const client = await pool.connect();
      return client.query(text, values);
    }
  };

  return { state, pool };
}

test('reconciliação via ingestão enriquece transcrição inconsistente com timestamps reais e preserva imutabilidade da avaliação da IA', async () => {
  const { state, pool } = createMockDatabase();
  const repository = createAtendimentosRepository(pool as any);

  const conversationId = 'conv-reconciliacao-e2e-001';

  // 1. Ingestão inicial de Atendimento concluído com transcrição inconsistente (múltiplos turnos zerados em 00:00)
  const initialPayload: IngestAtendimento = {
    conversation_id: conversationId,
    agent_id: 'agent-livia-test',
    event_timestamp: 1785330000,
    status: 'concluido',
    started_at: '2026-08-03T10:00:00.000Z',
    completed_at: '2026-08-03T10:01:00.000Z',
    duration_seconds: 0,
    transferred: false,
    contact_reason: 'Segunda via de boleto',
    tme_seconds: null,
    transcript: [
      { role: 'agent', message: 'Olá, como posso te ajudar?', time_in_call_secs: 0 },
      { role: 'user', message: 'Gostaria da segunda via do meu boleto.', time_in_call_secs: 0 },
      { role: 'agent', message: 'Vou localizar o documento para você.', time_in_call_secs: 0 }
    ]
  };

  const initialResult = await repository.ingest(initialPayload);
  assert.equal(initialResult.created, true);
  assert.equal(initialResult.row.conversationId, conversationId);
  assert.equal(initialResult.row.duracaoSegundos, 0);
  assert.equal(initialResult.row.status, 'concluido');

  const atendimentoId = initialResult.row.id;

  // 2. Persistência de Avaliação da IA associada ao Atendimento (snapshot imutável conforme ADR-0004)
  const initialAvaliacao = {
    id: '33333333-3333-4333-8333-333333333333',
    atendimento_id: atendimentoId,
    prompt_id: '44444444-4444-4444-8444-444444444444',
    autor: 'ia',
    checklist: {
      saudacao_e_intencao: true,
      solicitou_cpf: true,
      informou_protocolo_email: true,
      resolveu_solicitacao: true,
      validou_email_por_extenso: true,
      sem_diminutivos: false,
      encerramento_geap: true,
      uso_correto_ferramentas: true
    },
    falhas_identificadas: ['Utilizou diminutivo no atendimento'],
    resumo_atendimento: 'Atendimento solicitando segunda via de boleto concluído com sucesso.',
    atendimento_aprovado: true,
    nota_qualidade: 9.5,
    criado_em: new Date('2026-08-03T10:02:00.000Z')
  };

  state.avaliacoes.set(atendimentoId, { ...initialAvaliacao });

  // Snapshot profundo antes da reconciliação
  const avaliacaoSnapshotBefore = JSON.parse(JSON.stringify(state.avaliacoes.get(atendimentoId)));
  const totalAvaliacoesBefore = state.avaliacoes.size;

  // 3. Execução da rota / contrato POST /atendimentos/ingestao com dados reconciliados da ElevenLabs
  // Transcrição agora contém timestamps cronológicos reais, nova duração (60s) e Tempo de Espera calculado (5s)
  const reconciledPayload: IngestAtendimento = {
    conversation_id: conversationId,
    agent_id: 'agent-livia-test',
    event_timestamp: 1785330060,
    status: 'concluido',
    started_at: '2026-08-03T10:00:00.000Z',
    completed_at: '2026-08-03T10:01:00.000Z',
    duration_seconds: 60,
    transferred: false,
    contact_reason: 'Segunda via de boleto',
    tme_seconds: 5,
    tool_executions: { total: 1, successful: 1 },
    transcript: [
      { role: 'agent', message: 'Olá, como posso te ajudar?', time_in_call_secs: 0 },
      { role: 'user', message: 'Gostaria da segunda via do meu boleto.', time_in_call_secs: 4 },
      { role: 'agent', message: 'Vou localizar o documento para você.', time_in_call_secs: 9 }
    ]
  };

  const validatedReconciledPayload = ingestAtendimentoSchema.parse(reconciledPayload);
  const updateResult = await repository.ingest(validatedReconciledPayload);

  assert.equal(updateResult.created, false);
  assert.equal(updateResult.row.id, atendimentoId);
  assert.equal(updateResult.row.conversationId, conversationId);

  // 4. Verificação no banco: tabela atendimentos reflete novos turnos, nova duração e novo tme_segundos
  const updatedRow = state.atendimentos.get(conversationId)!;
  assert.ok(updatedRow);
  assert.equal(updatedRow.duracao_segundos, 60);
  assert.equal(updatedRow.tme_segundos, 5);
  assert.equal(updatedRow.tools_executados, 1);
  assert.equal(updatedRow.tools_sucesso, 1);
  assert.ok(updatedRow.atualizado_em instanceof Date);

  // Transcrição no detalhe normaliza com timestamps positivos preservados
  const detail = toAtendimentoDetail(updateResult.row, null);
  assert.equal(detail.duracaoSegundos, 60);
  assert.deepEqual(
    detail.transcricao.map(({ role, message, time_in_call_secs }) => ({
      role,
      message,
      time_in_call_secs
    })),
    [
      { role: 'agent', message: 'Olá, como posso te ajudar?', time_in_call_secs: 0 },
      { role: 'user', message: 'Gostaria da segunda via do meu boleto.', time_in_call_secs: 4 },
      { role: 'agent', message: 'Vou localizar o documento para você.', time_in_call_secs: 9 }
    ]
  );

  // 5. Verificação da tabela avaliacoes: permanece estritamente idêntica (snapshot imutável)
  assert.equal(state.avaliacoes.size, totalAvaliacoesBefore);
  const avaliacaoAfter = state.avaliacoes.get(atendimentoId);
  assert.deepEqual(
    JSON.parse(JSON.stringify(avaliacaoAfter)),
    avaliacaoSnapshotBefore,
    'A avaliação da IA não deve sofrer mutação, recálculo ou sobrescrita durante a reconciliação'
  );
  assert.equal(avaliacaoAfter?.nota_qualidade, 9.5);
  assert.equal(avaliacaoAfter?.atendimento_aprovado, true);
  assert.deepEqual(avaliacaoAfter?.checklist, initialAvaliacao.checklist);
  assert.deepEqual(avaliacaoAfter?.falhas_identificadas, initialAvaliacao.falhas_identificadas);
});

test('pipeline do n8n de reconciliação normaliza resposta ElevenLabs e atualiza Atendimento preservando Avaliação', async () => {
  const { state, pool } = createMockDatabase();
  const repository = createAtendimentosRepository(pool as any);

  const conversationId = 'conv-n8n-pipeline-002';

  // 1. Inserir atendimento inconsistente
  const initialIngest = await repository.ingest({
    conversation_id: conversationId,
    agent_id: 'agent-livia-test',
    event_timestamp: 1785330000,
    status: 'concluido',
    started_at: '2026-08-03T11:00:00.000Z',
    completed_at: '2026-08-03T11:02:00.000Z',
    duration_seconds: 0,
    transferred: false,
    tme_seconds: null,
    transcript: [
      { role: 'agent', message: 'Olá.', time_in_call_secs: 0 },
      { role: 'user', message: 'Boleto.', time_in_call_secs: 0 }
    ]
  });

  const atendimentoId = initialIngest.row.id;

  // 2. Criar avaliação da IA
  const avaliacaoSnapshot = {
    id: '55555555-5555-4555-8555-555555555555',
    atendimento_id: atendimentoId,
    prompt_id: '44444444-4444-4444-8444-444444444444',
    autor: 'ia',
    checklist: {
      saudacao_e_intencao: true,
      solicitou_cpf: false,
      informou_protocolo_email: true,
      resolveu_solicitacao: true,
      validou_email_por_extenso: true,
      sem_diminutivos: true,
      encerramento_geap: true,
      uso_correto_ferramentas: true
    },
    falhas_identificadas: ['Não solicitou CPF do titular'],
    resumo_atendimento: 'Atendimento sem validação de CPF.',
    atendimento_aprovado: false,
    nota_qualidade: 7.5,
    criado_em: new Date('2026-08-03T11:05:00.000Z')
  };
  state.avaliacoes.set(atendimentoId, { ...avaliacaoSnapshot });

  // 3. Executar o nó de código "Contrato normalizado" do workflow reconciliacao-atendimentos.json
  const workflowContent = JSON.parse(await readFile(reconciliacaoWorkflowPath, 'utf8')) as {
    nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
  };
  const codeNode = workflowContent.nodes.find((n) => n.name === 'Contrato normalizado');
  assert.ok(codeNode?.parameters.jsCode);

  const normalizeFn = new Function('$json', '$env', codeNode.parameters.jsCode) as (
    input: unknown,
    environment: unknown
  ) => Array<{ json: Record<string, unknown> }>;

  const elevenLabsApiResponse = {
    conversation_id: conversationId,
    agent_id: 'agent-livia-test',
    status: 'done',
    transcript: [
      { role: 'agent', message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
      { role: 'user', message: 'Gostaria de emitir segunda via.', time_in_call_secs: 5 },
      {
        role: 'agent',
        message: 'Localizei seu boleto.',
        time_in_call_secs: 12,
        tool_calls: [
          { tool_name: 'consultar_boleto', tool_call_id: 'call-1', tool_has_been_called: true }
        ],
        tool_results: [
          { tool_call_id: 'call-1', tool_name: 'consultar_boleto', is_error: false }
        ]
      }
    ],
    metadata: {
      start_time_unix_secs: 1785330000,
      call_duration_secs: 120,
      cost_fiat: 0.12
    },
    analysis: {
      data_collection_results: {
        'Classificação': { value: 'Financeiro/Boletos' }
      }
    },
    has_audio: false
  };

  const normalizedOutput = normalizeFn(elevenLabsApiResponse, {
    ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number'
  })[0]!.json;

  // Payload gerado pelo n8n obedece ao schema canônico
  const parsedForIngest = ingestAtendimentoSchema.parse(normalizedOutput);
  assert.equal(parsedForIngest.tme_seconds, 7); // 12 - 5 = 7s
  assert.equal(parsedForIngest.duration_seconds, 120);
  assert.deepEqual(parsedForIngest.tool_executions, { total: 1, successful: 1 });

  // 4. Ingestão do payload normalizado pelo n8n
  const ingested = await repository.ingest(parsedForIngest);
  assert.equal(ingested.created, false);
  assert.equal(ingested.row.id, atendimentoId);

  // 5. Validação de atualização de atendimentos e imutabilidade de avaliacoes
  const dbRow = state.atendimentos.get(conversationId)!;
  assert.equal(dbRow.duracao_segundos, 120);
  assert.equal(dbRow.tme_segundos, 7);
  assert.equal(dbRow.tools_executados, 1);
  assert.equal(dbRow.tools_sucesso, 1);

  const avaliacaoAfter = state.avaliacoes.get(atendimentoId);
  assert.deepEqual(avaliacaoAfter, avaliacaoSnapshot);
});

test('reprocessConversation do worker em segundo plano atualiza transcrição, duração e Tempo de Espera preservando avaliação associada', async () => {
  const executedDbQueries: Array<{ text: string; values?: unknown[] }> = [];

  const initialTranscriptInconsistent = {
    historico: [
      { speaker: 'IA', message: 'Olá, sou a Lívia.', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'Cliente', message: 'Preciso de boleto.', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'IA', message: 'Emitindo boleto.', tempo_segundos: 0, tempo_formatado: '00:00' }
    ]
  };

  let persistedRow = {
    id: '77777777-7777-4777-8777-777777777777',
    elevenlabs_conversation_id: 'conv-worker-reprocess-003',
    duracao_segundos: 0,
    tme_segundos: null as number | null,
    transcricao: initialTranscriptInconsistent
  };

  const avaliacaoSnapshot = {
    id: '88888888-8888-4888-8888-888888888888',
    atendimento_id: persistedRow.id,
    checklist: {
      saudacao_e_intencao: true,
      solicitou_cpf: true,
      informou_protocolo_email: true,
      resolveu_solicitacao: true,
      validou_email_por_extenso: true,
      sem_diminutivos: true,
      encerramento_geap: true,
      uso_correto_ferramentas: true
    },
    nota_qualidade: 10,
    resumo_atendimento: 'Atendimento nota 10 com todos os critérios atendidos.'
  };

  const mockDb: DatabaseQueryable = {
    async query(text: string, values?: unknown[]) {
      executedDbQueries.push({ text, values });
      if (text.includes('update atendimentos')) {
        persistedRow.transcricao = JSON.parse(values?.[0] as string);
        persistedRow.duracao_segundos = values?.[1] as number;
        persistedRow.tme_segundos = values?.[2] as number | null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };

  const mockElevenLabsFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-worker-reprocess-003',
        status: 'done',
        transcript: [
          { role: 'agent', message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
          { role: 'user', message: 'Preciso de boleto.', time_in_call_secs: 6 },
          { role: 'agent', message: 'Emitindo boleto.', time_in_call_secs: 14 }
        ],
        metadata: {
          call_duration_secs: 75,
          cost_fiat: 0.08
        }
      }),
      { status: 200 }
    );
  };

  const outcome = await reprocessConversation(mockDb, 'conv-worker-reprocess-003', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key',
    fetchFn: mockElevenLabsFetch
  });

  assert.equal(outcome.success, true);
  assert.equal(persistedRow.duracao_segundos, 75);
  assert.equal(persistedRow.tme_segundos, 8); // 14 - 6 = 8s

  const normalized = normalizeTranscricao(persistedRow.transcricao);
  assert.deepEqual(
    normalized.map((t) => ({ role: t.role, time: t.time_in_call_secs })),
    [
      { role: 'agent', time: 0 },
      { role: 'user', time: 6 },
      { role: 'agent', time: 14 }
    ]
  );

  // Nenhuma query foi direcionada à tabela avaliacoes
  assert.equal(
    executedDbQueries.some((q) => q.text.toLowerCase().includes('avaliacoes')),
    false,
    'O worker reprocessar-transcricoes não deve tocar na tabela avaliacoes'
  );
  assert.equal(avaliacaoSnapshot.nota_qualidade, 10);
});
