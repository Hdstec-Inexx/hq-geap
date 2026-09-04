import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  atendimentoListSchema,
  atendimentoSummarySchema,
  atendimentosQuerySchema,
  formatTime,
  ingestAtendimentoSchema,
  normalizeTranscricao,
  transcriptEntrySchema,
  transformToHistoricoTranscricao
} from '../../packages/contracts/src/atendimentos.js';
import { toAtendimentoDetail, toAtendimentoSummary } from '../../apps/api/src/modules/atendimentos/service.js';
import type { AtendimentoRow, AtendimentoSummaryRow } from '../../apps/api/src/modules/atendimentos/repository.js';

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
    notaIa: null,
    eventTimestamp: '1785330252',
    audioReference: 'atendimentos/conv-tool-null-message.mp3',
    curadorId: null,
    curadorNome: null,
    curadoriaNota: null,
    curadoriaRealizadaEm: null,
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

test('lista de Atendimentos usa envelope paginado com items e total', () => {
  assert.equal(atendimentoListSchema.safeParse([]).success, false);
  assert.deepEqual(atendimentoListSchema.parse({ items: [], total: 0 }), {
    items: [],
    total: 0
  });
});

const atendimentoSummaryBase = {
  id: '21f908bd-3728-4bfd-8035-3abd750b74d7',
  conversationId: 'conv-1',
  agenteVoz: {
    id: '11111111-1111-4111-8111-111111111111',
    nome: 'Lívia',
    agentId: 'agent-livia-test'
  },
  status: 'concluido' as const,
  iniciadoEm: '2026-08-03T10:00:00.000Z',
  concluidoEm: '2026-08-03T10:05:00.000Z',
  duracaoSegundos: 300,
  motivoContato: 'Financeiro/Boletos',
  houveTransferencia: false,
  custo: 0.15,
  curadoria: {
    realizada: false,
    curadorId: null,
    curadorNome: null,
    nota: null,
    realizadaEm: null
  }
};

test('resumo de Atendimento inclui nota da IA Avaliadora ou nulo', () => {
  assert.equal(
    atendimentoSummarySchema.parse({ ...atendimentoSummaryBase, notaIa: 9.5 }).notaIa,
    9.5
  );
  assert.equal(
    atendimentoSummarySchema.parse({ ...atendimentoSummaryBase, notaIa: null }).notaIa,
    null
  );
  assert.equal(atendimentoSummarySchema.safeParse(atendimentoSummaryBase).success, false);
});

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
  const parsed = ingestAtendimentoSchema.parse(fixture.normalized);
  assert.equal(parsed.conversation_id, fixture.normalized.conversation_id);
  assert.equal(parsed.audio_reference, fixture.normalized.audio_reference);
  assert.equal(parsed.status, fixture.normalized.status);
  assert.equal(
    parsed.transcript[2]?.message,
    'Vou enviar o boleto e o protocolo para o e-mail cadastrado.\n[Chamada de Ferramenta: enviar_segunda_via_boleto]'
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
    workflow.connections['Contrato normalizado']?.main[0]?.[0]?.node,
    workflow.nodes.find((node) => node.name.startsWith('Possui'))?.name
  );
  assert.equal(workflow.connections['Confirmar recebimento'], undefined);
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

test('Contrato normalizado arredonda Tempo de Espera com timestamps fracionários', async () => {
  const generated = await runContratoNormalizado([
    { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 5.5 },
    { role: 'agent', message: 'Claro.', time_in_call_secs: 9 }
  ]);

  // Persist integer seconds: 9 − 5.5 = 3.5 → 4
  assert.equal(generated.tme_seconds, 4);
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

test('transcriptEntrySchema aceita time_in_call_secs e tempo_segundos (numericos e strings)', () => {
  assert.deepEqual(
    transcriptEntrySchema.parse({
      role: 'agent',
      message: 'Olá',
      time_in_call_secs: 12
    }),
    { role: 'agent', message: 'Olá', time_in_call_secs: 12 }
  );
  assert.deepEqual(
    transcriptEntrySchema.parse({
      role: 'user',
      message: 'Oi',
      time_in_call_secs: '18.5'
    }),
    { role: 'user', message: 'Oi', time_in_call_secs: 18.5 }
  );
  assert.deepEqual(
    transcriptEntrySchema.parse({
      speaker: 'IA',
      message: 'Como posso ajudar?',
      tempo_segundos: 20
    }),
    { role: 'agent', message: 'Como posso ajudar?', time_in_call_secs: 20 }
  );
  assert.deepEqual(
    transcriptEntrySchema.parse({
      speaker: 'Cliente',
      message: 'Segunda via',
      tempo_segundos: '25'
    }),
    { role: 'user', message: 'Segunda via', time_in_call_secs: 25 }
  );
});

test('transcriptEntrySchema mapeia role e speaker de forma consistente', () => {
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'IA', message: 'teste', tempo_segundos: 0 }).role,
    'agent'
  );
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'assistente', message: 'teste', time_in_call_secs: 0 }).role,
    'agent'
  );
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'agente', message: 'teste', time_in_call_secs: 0 }).role,
    'agent'
  );
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'Cliente', message: 'teste', tempo_segundos: 0 }).role,
    'user'
  );
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'user', message: 'teste', time_in_call_secs: 0 }).role,
    'user'
  );
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'usuario', message: 'teste', time_in_call_secs: 0 }).role,
    'user'
  );
  assert.equal(
    transcriptEntrySchema.parse({ speaker: 'usuário', message: 'teste', time_in_call_secs: 0 }).role,
    'user'
  );
});

test('transcriptEntrySchema formata tool_calls e ignora tool_has_been_called false', () => {
  const result = transcriptEntrySchema.parse({
    role: 'agent',
    message: null,
    time_in_call_secs: 10,
    tool_calls: [
      { tool_name: 'consultar_cadastro', tool_has_been_called: true },
      { tool_name: 'transfer_to_number', tool_has_been_called: false }
    ]
  });
  assert.deepEqual(result, {
    role: 'agent',
    message: '[Chamada de Ferramenta: consultar_cadastro]',
    time_in_call_secs: 10
  });
});

test('transcriptEntrySchema formata tool_results e mapeia tool_name por tool_call_id', () => {
  const resultOk = transcriptEntrySchema.parse({
    role: 'agent',
    message: null,
    time_in_call_secs: 12,
    tool_calls: [
      { tool_name: 'enviar_boleto', tool_call_id: 'call-1', tool_has_been_called: true }
    ],
    tool_results: [
      { tool_call_id: 'call-1', is_error: false }
    ]
  });
  assert.deepEqual(resultOk, {
    role: 'agent',
    message: '[Chamada de Ferramenta: enviar_boleto]\n[Resultado da Ferramenta: enviar_boleto - Sucesso]',
    time_in_call_secs: 12
  });

  const resultFail = transcriptEntrySchema.parse({
    role: 'agent',
    message: null,
    time_in_call_secs: 14,
    tool_results: [
      { tool_name: 'consultar_dados', is_error: true }
    ]
  });
  assert.deepEqual(resultFail, {
    role: 'agent',
    message: '[Resultado da Ferramenta: consultar_dados - Falha]',
    time_in_call_secs: 14
  });
});

test('transcriptEntrySchema aplica fallback [Sem mensagem verbal] quando turno e vazio', () => {
  assert.deepEqual(
    transcriptEntrySchema.parse({
      role: 'agent',
      message: null,
      time_in_call_secs: 12
    }),
    { role: 'agent', message: '[Sem mensagem verbal]', time_in_call_secs: 12 }
  );
  assert.deepEqual(
    transcriptEntrySchema.parse({
      role: 'agent',
      message: '   ',
      time_in_call_secs: 15
    }),
    { role: 'agent', message: '[Sem mensagem verbal]', time_in_call_secs: 15 }
  );
});

test('transcriptEntrySchema concatena texto verbal com tool_calls e tool_results', () => {
  const combined = transcriptEntrySchema.parse({
    role: 'agent',
    message: 'Aguarde um momento.',
    time_in_call_secs: 5,
    tool_calls: [
      { tool_name: 'consultar_cadastro', tool_has_been_called: true }
    ],
    tool_results: [
      { tool_name: 'consultar_cadastro', is_error: false }
    ]
  });
  assert.deepEqual(combined, {
    role: 'agent',
    message: 'Aguarde um momento.\n[Chamada de Ferramenta: consultar_cadastro]\n[Resultado da Ferramenta: consultar_cadastro - Sucesso]',
    time_in_call_secs: 5
  });
});

test('transcriptEntrySchema rejeita role desconhecido e timestamps invalidos', () => {
  assert.equal(
    transcriptEntrySchema.safeParse({
      role: 'system',
      message: 'sistema',
      time_in_call_secs: 0
    }).success,
    false
  );
  assert.equal(
    transcriptEntrySchema.safeParse({
      role: 'agent',
      message: 'teste',
      time_in_call_secs: -5
    }).success,
    false
  );
  assert.equal(
    transcriptEntrySchema.safeParse({
      role: 'agent',
      message: 'teste',
      time_in_call_secs: 'invalido'
    }).success,
    false
  );
});

test('ingestAtendimentoSchema aceita transcricao com time_in_call_secs e message null', () => {
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

test('detalhe do Atendimento preserva tool call com message null na transcricao', () => {
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
        role: 'agent',
        message: '[Sem mensagem verbal]',
        time_in_call_secs: 12
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

test('normalizeTranscricao tolera raw_transcript gravado direto no Postgres pelo n8n sem fallback por indice', () => {
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
      { role: 'agent', message: '[Chamada de Ferramenta: transfer_to_number]', time_in_call_secs: 12 },
      { role: 'user', message: 'Preciso do boleto', time_in_call_secs: 18 },
      { role: 'agent', message: 'turno sem timestamp', time_in_call_secs: 0 }
    ]
  );

  const fromString = toAtendimentoDetail(
    detailRow({ transcricao: JSON.stringify(rawTranscript) }),
    null
  );
  assert.equal(fromString.transcricao.length, 4);
});

test('normalizeTranscricao normaliza historico do n8n com speaker IA/Cliente e tempo_segundos reais', () => {
  const historico = {
    historico: [
      {
        message: 'Olá sou a Livia da GEAP, Como posso te ajudar hoje?',
        speaker: 'IA',
        tempo_segundos: 0
      },
      {
        message: 'Oi, Lívia. Eu tô querendo um ortopedista perto de casa.',
        speaker: 'Cliente',
        tempo_segundos: 5
      },
      { message: '', speaker: 'IA', tempo_segundos: '12' },
      {
        message: 'A GEAP agradece o seu contato. Tenha um ótimo dia!',
        speaker: 'IA',
        tempo_segundos: 20
      }
    ]
  };

  const detail = toAtendimentoDetail(detailRow({ transcricao: historico }), null);
  assert.deepEqual(
    detail.transcricao.map(({ role, message, time_in_call_secs }) => ({ role, message, time_in_call_secs })),
    [
      {
        role: 'agent',
        message: 'Olá sou a Livia da GEAP, Como posso te ajudar hoje?',
        time_in_call_secs: 0
      },
      {
        role: 'user',
        message: 'Oi, Lívia. Eu tô querendo um ortopedista perto de casa.',
        time_in_call_secs: 5
      },
      {
        role: 'agent',
        message: '[Sem mensagem verbal]',
        time_in_call_secs: 12
      },
      {
        role: 'agent',
        message: 'A GEAP agradece o seu contato. Tenha um ótimo dia!',
        time_in_call_secs: 20
      }
    ]
  );

  const fromString = toAtendimentoDetail(
    detailRow({ transcricao: JSON.stringify(historico) }),
    null
  );
  assert.equal(fromString.transcricao.length, 4);
});

test('normalizeTranscricao preserva timestamps reais de turnos posteriores e nao inventa timestamps por indice', () => {
  const raw = [
    { role: 'agent', message: 'Início', time_in_call_secs: 0 },
    { role: 'user', message: 'Fala aos 40s', time_in_call_secs: 40 },
    { role: 'agent', message: 'Resposta aos 120s', tempo_segundos: 120 }
  ];
  const normalized = normalizeTranscricao(raw);
  assert.deepEqual(normalized, [
    { role: 'agent', message: 'Início', time_in_call_secs: 0 },
    { role: 'user', message: 'Fala aos 40s', time_in_call_secs: 40 },
    { role: 'agent', message: 'Resposta aos 120s', time_in_call_secs: 120 }
  ]);
});

test('normalizeTranscricao resolve tool_name por tool_call_id entre turnos distintos', () => {
  const raw = [
    {
      role: 'agent',
      message: null,
      time_in_call_secs: 10,
      tool_calls: [
        { tool_name: 'consultar_limite', tool_call_id: 'call-async-1', tool_has_been_called: true }
      ]
    },
    {
      role: 'agent',
      message: null,
      time_in_call_secs: 15,
      tool_results: [
        { tool_call_id: 'call-async-1', is_error: false }
      ]
    }
  ];
  const normalized = normalizeTranscricao(raw);
  assert.deepEqual(normalized, [
    {
      role: 'agent',
      message: '[Chamada de Ferramenta: consultar_limite]',
      time_in_call_secs: 10
    },
    {
      role: 'agent',
      message: '[Resultado da Ferramenta: consultar_limite - Sucesso]',
      time_in_call_secs: 15
    }
  ]);
});

test('query do Detalhamento rejeita indicador tme', () => {
  const result = atendimentosQuerySchema.safeParse({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    indicador: 'tme'
  });
  assert.equal(result.success, false);
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

test('query da lista aceita dia unico sem fim e defaultiza fim para inicio', () => {
  const singleDay = atendimentosQuerySchema.parse({
    inicio: '2026-08-03'
  });
  assert.equal(singleDay.inicio, '2026-08-03');
  assert.equal(singleDay.fim, '2026-08-03');

  const standaloneFim = atendimentosQuerySchema.safeParse({
    fim: '2026-08-03'
  });
  assert.equal(standaloneFim.success, false);
});

test('query da lista aceita filtro livre de motivo sem indicador', () => {
  const parsed = atendimentosQuerySchema.parse({
    motivo: 'Financeiro/Boletos'
  });
  assert.equal(parsed.motivo, 'Financeiro/Boletos');
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
  assert.match(resolvidas.clauses.join(' '), /at time zone 'America\/Sao_Paulo'/);
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
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$3/
  );
  assert.equal(motivo.values[2], 'Rede credenciada');

  const motivoNaoInformado = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'motivo',
      motivo: 'Não informado'
    })
  );
  assert.match(
    motivoNaoInformado.clauses.join(' '),
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$3/
  );
  assert.equal(motivoNaoInformado.values[2], 'Não informado');

  const motivoSemAcentoNormalizado = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      motivo: 'Nao informado'
    })
  );
  assert.match(
    motivoSemAcentoNormalizado.clauses.join(' '),
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$1/
  );
  assert.equal(motivoSemAcentoNormalizado.values[0], 'Não informado');

  const generalMotivo = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      motivo: 'Financeiro/Boletos'
    })
  );
  assert.match(
    generalMotivo.clauses.join(' '),
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$1/
  );
  assert.equal(generalMotivo.values[0], 'Financeiro/Boletos');

  const avaliadosIa = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'avaliados_ia'
    })
  );
  assert.match(
    avaliadosIa.clauses.join(' '),
    /from avaliacoes ia\s+where ia\.atendimento_id = a\.id and ia\.autor = 'ia'/
  );
  assert.deepEqual(avaliadosIa.values, ['2025-01-01', '2025-01-31']);

  const avaliadosCurador = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'avaliados_curador'
    })
  );
  assert.match(
    avaliadosCurador.clauses.join(' '),
    /from avaliacoes_curador curador\s+where curador\.atendimento_id = a\.id/
  );
  assert.deepEqual(avaliadosCurador.values, ['2025-01-01', '2025-01-31']);
});

test('formatTime formata segundos em mm:ss e hh:mm:ss', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(5), '00:05');
  assert.equal(formatTime(45), '00:45');
  assert.equal(formatTime(60), '01:00');
  assert.equal(formatTime(75), '01:15');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3665), '1:01:05');
  assert.equal(formatTime(null), '00:00');
  assert.equal(formatTime(undefined), '00:00');
  assert.equal(formatTime(-10), '00:00');
  assert.equal(formatTime(Number.NaN), '00:00');
});

test('transformToHistoricoTranscricao transforma transcript bruto da ElevenLabs em historico estruturado', () => {
  const rawTranscript = [
    {
      role: 'agent',
      message: 'Olá, sou a Lívia da GEAP.',
      time_in_call_secs: 0
    },
    {
      role: 'user',
      message: 'Preciso de ajuda com boleto.',
      time_in_call_secs: 5
    },
    {
      role: 'agent',
      message: null,
      time_in_call_secs: 12,
      tool_calls: [
        { tool_name: 'consultar_cadastro', tool_call_id: 'call-1', tool_has_been_called: true },
        { tool_name: 'transfer_to_number', tool_call_id: 'call-2', tool_has_been_called: false }
      ]
    },
    {
      role: 'agent',
      message: null,
      time_in_call_secs: 15,
      tool_results: [
        { tool_call_id: 'call-1', is_error: false }
      ]
    },
    {
      role: 'agent',
      message: 'Aqui está seu boleto.',
      time_in_call_secs: 75,
      tool_results: [
        { tool_name: 'enviar_email', is_error: true }
      ]
    },
    {
      role: 'agent',
      message: '   ',
      time_in_call_secs: 80
    }
  ];

  const result = transformToHistoricoTranscricao(rawTranscript);

  assert.deepEqual(result, {
    historico: [
      {
        speaker: 'IA',
        message: 'Olá, sou a Lívia da GEAP.',
        tempo_segundos: 0,
        tempo_formatado: '00:00'
      },
      {
        speaker: 'Cliente',
        message: 'Preciso de ajuda com boleto.',
        tempo_segundos: 5,
        tempo_formatado: '00:05'
      },
      {
        speaker: 'IA',
        message: '[Chamada de Ferramenta: consultar_cadastro]',
        tempo_segundos: 12,
        tempo_formatado: '00:12'
      },
      {
        speaker: 'IA',
        message: '[Resultado da Ferramenta: consultar_cadastro - Sucesso]',
        tempo_segundos: 15,
        tempo_formatado: '00:15'
      },
      {
        speaker: 'IA',
        message: 'Aqui está seu boleto.\n[Resultado da Ferramenta: enviar_email - Falha]',
        tempo_segundos: 75,
        tempo_formatado: '01:15'
      },
      {
        speaker: 'IA',
        message: '[Sem mensagem verbal]',
        tempo_segundos: 80,
        tempo_formatado: '01:20'
      }
    ]
  });
});

test('transformToHistoricoTranscricao aceita payload completo da conversa ElevenLabs ou string JSON', () => {
  const fullConversation = {
    conversation_id: 'conv-test-123',
    status: 'done',
    transcript: [
      { role: 'agent', message: 'Bom dia.', time_in_call_secs: 0 },
      { role: 'user', message: 'Bom dia.', time_in_call_secs: 3 }
    ]
  };

  const fromObject = transformToHistoricoTranscricao(fullConversation);
  assert.equal(fromObject.historico.length, 2);
  assert.equal(fromObject.historico[0]?.speaker, 'IA');
  assert.equal(fromObject.historico[0]?.tempo_formatado, '00:00');
  assert.equal(fromObject.historico[1]?.speaker, 'Cliente');
  assert.equal(fromObject.historico[1]?.tempo_formatado, '00:03');

  const fromJsonString = transformToHistoricoTranscricao(JSON.stringify(fullConversation));
  assert.deepEqual(fromJsonString, fromObject);
});

test('query da lista aceita curadoriaStatus e curadorId validos', () => {
  const queryTodos = atendimentosQuerySchema.parse({
    curadoriaStatus: 'todos'
  });
  assert.equal(queryTodos.curadoriaStatus, 'todos');

  const queryRealizada = atendimentosQuerySchema.parse({
    curadoriaStatus: 'realizada',
    curadorId: '11111111-1111-4111-8111-111111111111'
  });
  assert.equal(queryRealizada.curadoriaStatus, 'realizada');
  assert.equal(queryRealizada.curadorId, '11111111-1111-4111-8111-111111111111');

  const queryPendente = atendimentosQuerySchema.parse({
    curadoriaStatus: 'pendente'
  });
  assert.equal(queryPendente.curadoriaStatus, 'pendente');

  const invalidStatus = atendimentosQuerySchema.safeParse({
    curadoriaStatus: 'invalido'
  });
  assert.equal(invalidStatus.success, false);

  const invalidCuradorId = atendimentosQuerySchema.safeParse({
    curadorId: 'nao-e-uuid'
  });
  assert.equal(invalidCuradorId.success, false);
});

test('toAtendimentoSummary mapeia curadoria realizada e pendente corretamente', () => {
  const rowSemCuradoria: AtendimentoSummaryRow = {
    id: '21f908bd-3728-4bfd-8035-3abd750b74d7',
    conversationId: 'conv-1',
    agenteVozId: '11111111-1111-4111-8111-111111111111',
    agenteVozNome: 'Lívia',
    agentId: 'agent-livia-test',
    status: 'concluido',
    iniciadoEm: new Date('2026-08-03T10:00:00.000Z'),
    concluidoEm: new Date('2026-08-03T10:05:00.000Z'),
    duracaoSegundos: 300,
    motivoContato: 'Financeiro/Boletos',
    houveTransferencia: false,
    custo: '0.15',
    notaIa: null,
    eventTimestamp: '1785330252',
    curadorId: null,
    curadorNome: null,
    curadoriaNota: null,
    curadoriaRealizadaEm: null
  };

  const summarySemCuradoria = toAtendimentoSummary(rowSemCuradoria);
  assert.deepEqual(summarySemCuradoria.curadoria, {
    realizada: false,
    curadorId: null,
    curadorNome: null,
    nota: null,
    realizadaEm: null
  });

  const rowComCuradoria: AtendimentoSummaryRow = {
    ...rowSemCuradoria,
    curadorId: '33333333-3333-4333-8333-333333333333',
    curadorNome: 'Caio Curador',
    curadoriaNota: '8.50',
    curadoriaRealizadaEm: new Date('2026-08-03T11:00:00.000Z')
  };

  const summaryComCuradoria = toAtendimentoSummary(rowComCuradoria);
  assert.deepEqual(summaryComCuradoria.curadoria, {
    realizada: true,
    curadorId: '33333333-3333-4333-8333-333333333333',
    curadorNome: 'Caio Curador',
    nota: 8.5,
    realizadaEm: '2026-08-03T11:00:00.000Z'
  });
});

test('toAtendimentoSummary mapeia nota da IA Avaliadora e nulo quando ausente', () => {
  const row: AtendimentoSummaryRow = {
    id: '21f908bd-3728-4bfd-8035-3abd750b74d7',
    conversationId: 'conv-1',
    agenteVozId: '11111111-1111-4111-8111-111111111111',
    agenteVozNome: 'Lívia',
    agentId: 'agent-livia-test',
    status: 'concluido',
    iniciadoEm: new Date('2026-08-03T10:00:00.000Z'),
    concluidoEm: new Date('2026-08-03T10:05:00.000Z'),
    duracaoSegundos: 300,
    motivoContato: 'Financeiro/Boletos',
    houveTransferencia: false,
    custo: '0.15',
    notaIa: null,
    eventTimestamp: '1785330252',
    curadorId: null,
    curadorNome: null,
    curadoriaNota: null,
    curadoriaRealizadaEm: null
  };

  const semNota = toAtendimentoSummary(row);
  assert.equal(semNota.notaIa, null);

  const comNota = toAtendimentoSummary({
    ...row,
    notaIa: '9.50'
  });
  assert.equal(comNota.notaIa, 9.5);
});

test('filtros SQL suportam curadoriaStatus e curadorId', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const realizada = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      curadoriaStatus: 'realizada'
    })
  );
  assert.match(realizada.clauses.join(' '), /cur\.id is not null/);

  const pendente = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      curadoriaStatus: 'pendente'
    })
  );
  assert.match(pendente.clauses.join(' '), /a\.status = 'concluido' and cur\.id is null/);

  const curador = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      curadorId: '11111111-1111-4111-8111-111111111111'
    })
  );
  assert.match(curador.clauses.join(' '), /cur\.autor_usuario_id = \$1/);
  assert.deepEqual(curador.values, ['11111111-1111-4111-8111-111111111111']);
});

test('filtros SQL suportam criteriosAtendidos e criteriosNaoAtendidos com conjuncao AND para IA', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      criteriosAtendidos: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222'
      ],
      criteriosNaoAtendidos: ['33333333-3333-4333-8333-333333333333']
    }),
    1
  );

  assert.equal(filtro.clauses.length, 3);
  assert.match(
    filtro.clauses[0]!,
    /ac\.criterio_id = \$1::uuid\s+and\s+ac\.estado = 'atendido'/
  );
  assert.match(
    filtro.clauses[1]!,
    /ac\.criterio_id = \$2::uuid\s+and\s+ac\.estado = 'atendido'/
  );
  assert.match(
    filtro.clauses[2]!,
    /ac\.criterio_id = \$3::uuid\s+and\s+ac\.estado = 'nao_atendido'/
  );
  assert.deepEqual(filtro.values, [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  ]);
});

test('filtros SQL suportam conversationId com ILIKE', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      conversationId: 'conv-abc-123'
    }),
    1
  );

  assert.equal(filtro.clauses.length, 1);
  assert.match(
    filtro.clauses[0]!,
    /a\.elevenlabs_conversation_id ilike '%' \|\| \$1 \|\| '%'/
  );
  assert.deepEqual(filtro.values, ['conv-abc-123']);
});

test('lista de Atendimentos busca nota da IA por subquery para nao duplicar linhas', async () => {
  const { readFile } = await import('node:fs/promises');
  const repository = await readFile(
    new URL(
      '../../apps/api/src/modules/atendimentos/repository.ts',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    repository,
    /select avaliacao_ia\.nota[\s\S]*from avaliacoes avaliacao_ia[\s\S]*where avaliacao_ia\.atendimento_id = a\.id[\s\S]*and avaliacao_ia\.autor = 'ia'/
  );
  assert.doesNotMatch(
    repository,
    /left join avaliacoes avaliacao_ia/
  );
});

test('lista de Atendimentos exibe Nota da IA Avaliadora formatada no card', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(
    new URL('../../apps/web/src/features/atendimentos/AtendimentosPage.tsx', import.meta.url),
    'utf8'
  );
  assert.match(page, /<dt>Nota da IA Avaliadora<\/dt>/);
  assert.doesNotMatch(page, /<dt>Nota IA<\/dt>/);
  assert.match(page, /formatNotaIa\(atendimento\.notaIa\)/);
});

test('formatNotaIa formata nota da IA Avaliadora e em dash quando ausente', async () => {
  const { formatNotaIa } = await import(
    '../../apps/web/src/features/atendimentos/atendimento-facts-logic.js'
  );
  assert.equal(formatNotaIa(null), '—');
  assert.equal(formatNotaIa(9.5), '9,5');
});

test('formatDate formata datas ISO no fuso oficial e trata nulos e invalidos', async () => {
  const { formatDate, formatAtendimentoDate } = await import(
    '../../apps/web/src/features/atendimentos/atendimento-facts-logic.js'
  );

  assert.equal(formatDate(null), 'Não informado');
  assert.equal(formatDate(undefined), 'Não informado');
  assert.equal(formatDate(''), 'Não informado');
  assert.equal(formatDate('invalid-date'), 'Data inválida');

  // Teste com data UTC fixa e verificação do padrão DD/MM/AAAA, HH:mm
  const formatted = formatDate('2026-08-25T20:09:00.000Z');
  // 20:09 UTC -> 17:09 America/Sao_Paulo (UTC-3)
  assert.match(formatted, /25\/08\/2026[,\s]+17:09/);

  // formatAtendimentoDate usa concluidoEm com prioridade e fallback para iniciadoEm
  assert.match(
    formatAtendimentoDate({
      concluidoEm: '2026-08-25T20:09:00.000Z',
      iniciadoEm: '2026-08-25T20:00:00.000Z'
    }),
    /25\/08\/2026[,\s]+17:09/
  );

  assert.match(
    formatAtendimentoDate({
      concluidoEm: null,
      iniciadoEm: '2026-08-25T20:00:00.000Z'
    }),
    /25\/08\/2026[,\s]+17:00/
  );

  assert.equal(
    formatAtendimentoDate({
      concluidoEm: null,
      iniciadoEm: null
    }),
    'Não informado'
  );
});




