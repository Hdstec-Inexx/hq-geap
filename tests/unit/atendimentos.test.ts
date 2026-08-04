import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
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
      { role: 'agent', message: '', time_in_call_secs: 12 },
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
