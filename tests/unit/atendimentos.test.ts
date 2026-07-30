import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ingestAtendimentoSchema } from '../../packages/contracts/src/atendimentos.js';

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
