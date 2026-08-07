import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  atendimentosQuerySchema,
  ingestAtendimentoSchema,
  transcriptEntrySchema
} from '../../packages/contracts/src/atendimentos.js';
import { toAtendimentoDetail } from '../../apps/api/src/modules/atendimentos/service.js';
import type { AtendimentoRow } from '../../apps/api/src/modules/atendimentos/repository.js';

function detailRow(
  overrides: Partial<AtendimentoRow> = {}
): AtendimentoRow {
  return {
    id: '21f908bd-3728-4bfd-8035-3abd750b74d7',
    conversationId: 'conv-tool-null-message',
    agenteVozId: '11111111-1111-4111-8111-111111111111',
    agenteVozNome: 'Lívia',
    agentId: 'agent-livia-test',
    status: 'concluido',
    iniciadoEm: new Date('2026-08-03T10:00:00.000Z'),
    concluidoEm: new Date('2026-08-03T10:05:00.000Z'),
    duracaoSegundos: 300,
    motivoContato: 'Financeiro/Boletos',
    houveTransferencia: true,
    custo: '0.1842',
    eventTimestamp: '1785330252',
    audioReference: 'atendimentos/conv-tool-null-message.mp3',
    transcricao: [
      {
        role: 'agent',
        message: 'Olá, como posso ajudar?',
        time_in_call_secs: 0
      },
      {
        role: 'agent',
        message: null,
        time_in_call_secs: 12
      },
      {
        role: 'user',
        message: 'Preciso da segunda via.',
        time_in_call_secs: 18
      }
    ],
    ...overrides
  };
}

const fixturePath = new URL(
  '../fixtures/elevenlabs/atendimento-concluido.json',
  import.meta.url
);
const workflowPath = new URL(
  '../../n8n/workflows/ingestao-atendimento.json',
  import.meta.url
);
const require = createRequire(import.meta.url);

type Workflow = {
  connections: Record<
    string,
    { main: Array<Array<{ node: string; type: string; index: number }>> }
  >;
  nodes: Array<{
    name: string;
    parameters: { jsCode?: string; options?: { rawBody?: boolean } };
  }>;
};

async function loadWorkflow() {
  return JSON.parse(await readFile(workflowPath, 'utf8')) as Workflow;
}

function workflowCode(workflow: Workflow, nodeName: string) {
  return workflow.nodes.find((node) => node.name === nodeName)?.parameters.jsCode ?? '';
}

type TranscriptTurn = {
  role: string;
  message?: string | null;
  time_in_call_secs?: number | null;
  tool_calls?: unknown[];
  tool_results?: unknown[];
};

async function runContratoNormalizado(
  transcript: TranscriptTurn[],
  overrides: Record<string, unknown> = {}
) {
  const workflow = await loadWorkflow();
  const code = workflowCode(workflow, 'Contrato normalizado');
  const execute = new Function('$json', '$env', code) as (
    json: unknown,
    environment: unknown
  ) => Array<{ json: Record<string, unknown> }>;
  return execute(
    {
      event: {
        type: 'post_call_transcription',
        event_timestamp: 1785330252,
        data: {
          conversation_id: 'conv-tempo-espera',
          agent_id: 'agent-livia-test',
          status: 'done',
          has_audio: false,
          transcript,
          metadata: {
            start_time_unix_secs: 1785330000,
            call_duration_secs: 60,
            cost_fiat: 0.1
          },
          analysis: { data_collection_results: {} },
          ...overrides
        }
      }
    },
    { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
  )[0]!.json;
}

test('o contrato preserva a referencia de storage normalizada pelo n8n', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    data: { audio_url?: string; has_audio: boolean };
    normalized: Record<string, unknown>;
  };

  assert.equal(fixture.data.has_audio, true);
  assert.equal(fixture.data.audio_url, undefined);
  assert.deepEqual(
    ingestAtendimentoSchema.parse(fixture.normalized),
    fixture.normalized
  );
});

test('a fixture permite Motivo de Contato ausente', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    normalized: Record<string, unknown>;
  };
  const withoutContactReason = { ...fixture.normalized };
  delete withoutContactReason.contact_reason;

  assert.equal(
    ingestAtendimentoSchema.parse(withoutContactReason).contact_reason,
    undefined
  );
});

test('contrato de ingestao aceita TME e contadores de tools', () => {
  const parsed = ingestAtendimentoSchema.parse({
    conversation_id: 'conv-tme-tools',
    agent_id: 'agent-1',
    event_timestamp: 1,
    status: 'concluido',
    started_at: '2026-08-03T10:00:00.000Z',
    completed_at: '2026-08-03T10:05:00.000Z',
    duration_seconds: 300,
    transferred: false,
    transcript: [
      { role: 'agent', message: 'Olá', time_in_call_secs: 12 }
    ],
    tme_seconds: 12,
    tool_executions: { total: 2, successful: 1 }
  });

  assert.equal(parsed.tme_seconds, 12);
  assert.deepEqual(parsed.tool_executions, { total: 2, successful: 1 });
});

test('contrato de ingestao rejeita tools bem-sucedidas acima do total', () => {
  const result = ingestAtendimentoSchema.safeParse({
    conversation_id: 'conv-tools-invalid',
    agent_id: 'agent-1',
    event_timestamp: 1,
    status: 'concluido',
    started_at: '2026-08-03T10:00:00.000Z',
    completed_at: '2026-08-03T10:05:00.000Z',
    duration_seconds: 300,
    transferred: false,
    transcript: [],
    tool_executions: { total: 1, successful: 2 }
  });

  assert.equal(result.success, false);
});

test('o workflow valida HMAC sobre o corpo bruto antes da ingestao', async () => {
  const workflow = await loadWorkflow();
  const webhook = workflow.nodes.find((node) => node.name === 'Webhook ElevenLabs');
  const code = workflowCode(workflow, 'Validar assinatura ElevenLabs');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<
    string,
    unknown
  >;
  fixture.event_timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(fixture);
  const timestamp = String(fixture.event_timestamp);
  const secret = 'test-webhook-secret';
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...arguments_: string[]
  ) => (...values: unknown[]) => Promise<Array<{ json: { valid: boolean } }>>;
  const execute = new AsyncFunction('$input', '$env', 'require', code);
  const context = {
    helpers: {
      async getBinaryDataBuffer() {
        return Buffer.from(rawBody);
      }
    }
  };
  const input = {
    first() {
      return {
        json: {
          headers: { 'elevenlabs-signature': `t=${timestamp},v0=${signature}` }
        }
      };
    }
  };

  assert.equal(webhook?.parameters.options?.rawBody, true);
  assert.equal(
    (await execute.call(context, input, { ELEVENLABS_WEBHOOK_SECRET: secret }, require))[0]
      ?.json.valid,
    true
  );
  input.first = () => ({
    json: { headers: { 'elevenlabs-signature': `t=${timestamp},v0=${'0'.repeat(64)}` } }
  });
  assert.equal(
    (await execute.call(context, input, { ELEVENLABS_WEBHOOK_SECRET: secret }, require))[0]
      ?.json.valid,
    false
  );
  assert.equal(
    workflow.connections['Persistir Atendimento']?.main[0]?.[0]?.node,
    'Confirmar recebimento'
  );
  assert.equal(
    workflow.connections['Confirmar recebimento']?.main[0]?.[0]?.node,
    'Possui áudio?'
  );
});

test('o workflow transforma a fixture real no contrato esperado', async () => {
  const workflow = await loadWorkflow();
  const code = workflowCode(workflow, 'Contrato normalizado');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    data: Record<string, unknown>;
    event_timestamp: number;
    normalized: Record<string, unknown>;
    type: string;
  };
  const execute = new Function('$json', '$env', code) as (
    json: unknown,
    environment: unknown
  ) => Array<{ json: Record<string, unknown> }>;
  const generated = execute(
    { event: { type: fixture.type, event_timestamp: fixture.event_timestamp, data: fixture.data } },
    { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
  )[0]!.json;
  const { has_audio, audio_object_key, ...payload } = generated;
  const { audio_reference, ...expected } = fixture.normalized;

  assert.equal(has_audio, true);
  assert.equal(audio_object_key, audio_reference);
  assert.deepEqual(payload, expected);
});

test('Contrato normalizado deriva Tempo de Espera como intervalo cliente → 2ª fala do agente', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 5 },
    { role: 'agent', message: 'Claro, como posso ajudar?', time_in_call_secs: 9 }
  ]);

  assert.equal(generated.tme_seconds, 4);
});

test('Contrato normalizado grava null quando só há apresentação do agente', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 }
  ]);

  assert.equal(generated.tme_seconds, null);
});

test('Contrato normalizado grava null sem fala do cliente', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'agent', message: 'Posso ajudar?', time_in_call_secs: 4 }
  ]);

  assert.equal(generated.tme_seconds, null);
});

test('Contrato normalizado grava null sem segunda fala do agente', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 5 }
  ]);

  assert.equal(generated.tme_seconds, null);
});

test('Contrato normalizado grava null com timestamps inválidos', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: Number.NaN },
    { role: 'agent', message: 'Claro.', time_in_call_secs: 9 }
  ]);

  assert.equal(generated.tme_seconds, null);
});

test('Contrato normalizado grava null com timestamps não-inteiros', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 5.5 },
    { role: 'agent', message: 'Claro.', time_in_call_secs: 9 }
  ]);

  assert.equal(generated.tme_seconds, null);
});

test('Contrato normalizado grava null quando o intervalo seria negativo', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 12 },
    { role: 'agent', message: 'Claro.', time_in_call_secs: 9 }
  ]);

  assert.equal(generated.tme_seconds, null);
});

test('workflow conta falha de tool_results.is_error na Taxa de Promessas', async () => {
  const workflow = await loadWorkflow();
  const code = workflowCode(workflow, 'Contrato normalizado');
  const execute = new Function('$json', '$env', code) as (
    json: unknown,
    environment: unknown
  ) => Array<{ json: Record<string, unknown> }>;
  const generated = execute(
    {
      event: {
        type: 'post_call_transcription',
        event_timestamp: 1785330252,
        data: {
          conversation_id: 'conv-tool-error',
          agent_id: 'agent-livia-test',
          status: 'done',
          has_audio: false,
          transcript: [
            {
              role: 'agent',
              message: 'Olá',
              time_in_call_secs: 5,
              tool_calls: [
                {
                  tool_name: 'enviar_segunda_via_boleto',
                  tool_call_id: 'tool-ok',
                  tool_has_been_called: true
                },
                {
                  tool_name: 'enviar_segunda_via_boleto',
                  tool_call_id: 'tool-fail',
                  tool_has_been_called: true
                },
                {
                  tool_name: 'enviar_segunda_via_boleto',
                  tool_call_id: 'tool-sem-result',
                  tool_has_been_called: true
                }
              ],
              tool_results: [
                {
                  tool_call_id: 'tool-ok',
                  tool_name: 'enviar_segunda_via_boleto',
                  is_error: false
                },
                {
                  tool_call_id: 'tool-fail',
                  tool_name: 'enviar_segunda_via_boleto',
                  is_error: true
                }
              ]
            }
          ],
          metadata: {
            start_time_unix_secs: 1785330000,
            call_duration_secs: 60,
            cost_fiat: 0.1
          },
          analysis: { data_collection_results: {} }
        }
      }
    },
    { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
  )[0]!.json;

  assert.equal(generated.tme_seconds, null);
  // total inclui chamada sem result; sucesso só tool-ok
  assert.deepEqual(generated.tool_executions, { total: 3, successful: 1 });
});

test('workflow sem tool_results nao conta sucesso na Taxa de Promessas', async () => {
  const workflow = await loadWorkflow();
  const code = workflowCode(workflow, 'Contrato normalizado');
  const execute = new Function('$json', '$env', code) as (
    json: unknown,
    environment: unknown
  ) => Array<{ json: Record<string, unknown> }>;
  const generated = execute(
    {
      event: {
        type: 'post_call_transcription',
        event_timestamp: 1785330252,
        data: {
          conversation_id: 'conv-tool-no-results',
          agent_id: 'agent-livia-test',
          status: 'done',
          has_audio: false,
          transcript: [
            {
              role: 'agent',
              message: 'Olá',
              time_in_call_secs: 2,
              tool_calls: [
                {
                  tool_name: 'enviar_segunda_via_boleto',
                  tool_call_id: 'tool-orphan',
                  tool_has_been_called: true
                }
              ]
            }
          ],
          metadata: {
            start_time_unix_secs: 1785330000,
            call_duration_secs: 40,
            cost_fiat: 0.1
          },
          analysis: { data_collection_results: {} }
        }
      }
    },
    { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
  )[0]!.json;

  assert.deepEqual(generated.tool_executions, { total: 1, successful: 0 });
});

test('contrato aceita message null de tool call da ElevenLabs', () => {
  assert.deepEqual(
    transcriptEntrySchema.parse({
      role: 'agent',
      message: null,
      time_in_call_secs: 12
    }),
    { role: 'agent', message: '', time_in_call_secs: 12 }
  );
  assert.equal(
    ingestAtendimentoSchema.safeParse({
      conversation_id: 'conv-1',
      agent_id: 'agent-1',
      event_timestamp: 1,
      status: 'concluido',
      started_at: '2026-08-03T10:00:00.000Z',
      completed_at: '2026-08-03T10:05:00.000Z',
      duration_seconds: 300,
      transferred: true,
      transcript: [
        { role: 'agent', message: null, time_in_call_secs: 12 },
        { role: 'user', message: 'oi', time_in_call_secs: 18 }
      ]
    }).success,
    true
  );
});

test('detalhe do Atendimento nao quebra com message null na transcricao', () => {
  const detail = toAtendimentoDetail(
    detailRow(),
    'https://example.com/atendimentos/conv-tool-null-message.mp3'
  );

  assert.equal(detail.id, '21f908bd-3728-4bfd-8035-3abd750b74d7');
  assert.deepEqual(
    detail.transcricao.map(({ role, message, time_in_call_secs }) => ({
      role,
      message,
      time_in_call_secs
    })),
    [
      {
        role: 'agent',
        message: 'Olá, como posso ajudar?',
        time_in_call_secs: 0
      },
      {
        role: 'user',
        message: 'Preciso da segunda via.',
        time_in_call_secs: 18
      }
    ]
  );
});

test('detalhe do Atendimento ignora audioUrl invalida em vez de 500', () => {
  const detail = toAtendimentoDetail(detailRow({ transcricao: [] }), '');
  assert.equal(detail.audioUrl, null);
});

test('detalhe tolera raw_transcript gravado direto no Postgres pelo n8n', () => {
  const rawTranscript = [
    {
      role: 'agent',
      message: 'Olá',
      tool_calls: null,
      tool_results: null,
      feedback: null,
      time_in_call_secs: 0,
      conversation_turn_metrics: null
    },
    {
      role: 'agent',
      message: null,
      tool_calls: [
        { tool_name: 'transfer_to_number', tool_has_been_called: true }
      ],
      tool_results: [],
      time_in_call_secs: 12
    },
    {
      role: 'user',
      message: 'Preciso do boleto',
      time_in_call_secs: '18'
    },
    {
      role: 'agent',
      message: 'turno sem timestamp'
    },
    {
      role: 'system',
      message: 'ignorar',
      time_in_call_secs: 20
    }
  ];

  const fromArray = toAtendimentoDetail(
    detailRow({ transcricao: rawTranscript }),
    null
  );
  assert.deepEqual(
    fromArray.transcricao.map(({ role, message, time_in_call_secs }) => ({
      role,
      message,
      time_in_call_secs
    })),
    [
      { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
      { role: 'user', message: 'Preciso do boleto', time_in_call_secs: 18 },
      { role: 'agent', message: 'turno sem timestamp', time_in_call_secs: 3 }
    ]
  );

  const fromString = toAtendimentoDetail(
    detailRow({ transcricao: JSON.stringify(rawTranscript) }),
    null
  );
  assert.equal(fromString.transcricao.length, 3);
});

test('detalhe exibe historico com speaker IA/Cliente gravado pelo n8n', () => {
  const historico = {
    historico: [
      {
        message: 'Olá sou a Livia da GEAP, Como posso te ajudar hoje?',
        speaker: 'IA'
      },
      {
        message: 'Oi, Lívia. Eu tô querendo um ortopedista perto de casa.',
        speaker: 'Cliente'
      },
      { message: '', speaker: 'IA' },
      {
        message: 'A GEAP agradece o seu contato. Tenha um ótimo dia!',
        speaker: 'IA'
      }
    ]
  };

  const detail = toAtendimentoDetail(detailRow({ transcricao: historico }), null);
  assert.deepEqual(
    detail.transcricao.map(({ role, message }) => ({ role, message })),
    [
      {
        role: 'agent',
        message: 'Olá sou a Livia da GEAP, Como posso te ajudar hoje?'
      },
      {
        role: 'user',
        message: 'Oi, Lívia. Eu tô querendo um ortopedista perto de casa.'
      },
      {
        role: 'agent',
        message: 'A GEAP agradece o seu contato. Tenha um ótimo dia!'
      }
    ]
  );

  const fromString = toAtendimentoDetail(
    detailRow({ transcricao: JSON.stringify(historico) }),
    null
  );
  assert.equal(fromString.transcricao.length, 3);
});

test('query da lista aceita filtros compartilháveis do Detalhamento', () => {
  const parsed = atendimentosQuerySchema.parse({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    indicador: 'resolvidas',
    limit: '20',
    offset: '0'
  });

  assert.equal(parsed.inicio, '2025-01-01');
  assert.equal(parsed.fim, '2025-01-31');
  assert.equal(parsed.indicador, 'resolvidas');
  assert.equal(parsed.limit, 20);
});

test('query do Detalhamento exige motivo para indicador motivo', () => {
  const result = atendimentosQuerySchema.safeParse({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    indicador: 'motivo'
  });
  assert.equal(result.success, false);
});

test('query do Detalhamento exige criterioId para criterio e concordancia_criterio', () => {
  for (const indicador of ['criterio', 'concordancia_criterio'] as const) {
    const missing = atendimentosQuerySchema.safeParse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador
    });
    assert.equal(missing.success, false);

    const ok = atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador,
      criterioId: '11111111-1111-4111-8111-111111111111'
    });
    assert.equal(ok.criterioId, '11111111-1111-4111-8111-111111111111');
  }
});

test('query do Detalhamento exige periodo valido quando ha indicador', () => {
  assert.equal(
    atendimentosQuerySchema.safeParse({ indicador: 'volume' }).success,
    false
  );
  assert.equal(
    atendimentosQuerySchema.safeParse({
      inicio: '2025-01-01',
      fim: '2026-01-02',
      indicador: 'volume'
    }).success,
    false
  );
});

test('filtros SQL do Detalhamento espelham populacoes positivas do Dashboard', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );
  const { SLA_TME_LIMITE_SEGUNDOS } = await import(
    '../../packages/contracts/src/dashboards.js'
  );

  const resolvidas = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'resolvidas'
    })
  );
  assert.match(resolvidas.clauses.join(' '), /not a\.houve_transferencia/);
  assert.deepEqual(resolvidas.values, ['2025-01-01', '2025-01-31']);

  const sla = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'sla'
    })
  );
  assert.match(sla.clauses.join(' '), /tme_segundos <= \$3/);
  assert.deepEqual(sla.values, [
    '2025-01-01',
    '2025-01-31',
    SLA_TME_LIMITE_SEGUNDOS
  ]);

  const motivo = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'motivo',
      motivo: 'Rede credenciada'
    })
  );
  assert.match(
    motivo.clauses.join(' '),
    /coalesce\(a\.motivo_contato, 'Nao informado'\) = \$3/
  );
  assert.equal(motivo.values[2], 'Rede credenciada');
});
