import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reconciliacaoPath = new URL(
  '../../n8n/workflows/reconciliacao-atendimentos.json',
  import.meta.url
);
const reprocessamentoPath = new URL(
  '../../n8n/workflows/reprocessar-atendimento.json',
  import.meta.url
);
const webhookPath = new URL(
  '../../n8n/workflows/ingestao-atendimento.json',
  import.meta.url
);
const detalheFixturePath = new URL(
  '../fixtures/elevenlabs/atendimento-concluido.json',
  import.meta.url
);
const listaFixturePath = new URL(
  '../fixtures/elevenlabs/lista-atendimentos.json',
  import.meta.url
);

type WorkflowNode = {
  name: string;
  type: string;
  parameters: Record<string, unknown> & { jsCode?: string };
  credentials?: Record<string, { id: string; name: string }>;
};

type Workflow = {
  name: string;
  nodes: WorkflowNode[];
  connections: Record<
    string,
    { main: Array<Array<{ node: string; type: string; index: number }>> }
  >;
};

async function loadWorkflow(path: URL) {
  return JSON.parse(await readFile(path, 'utf8')) as Workflow;
}

function node(workflow: Workflow, name: string) {
  return workflow.nodes.find((candidate) => candidate.name === name);
}

test('reconciliacao usa janela configuravel, pagina a ElevenLabs e seleciona somente ausentes', async () => {
  const workflow = await loadWorkflow(reconciliacaoPath);
  const serialized = JSON.stringify(workflow);
  const lista = JSON.parse(await readFile(listaFixturePath, 'utf8')) as {
    conversations: Array<{ conversation_id: string; status: string }>;
  };
  const extrairCode = node(workflow, 'Extrair Atendimentos concluídos')?.parameters.jsCode ?? '';
  const execute = new Function('$json', extrairCode) as (
    input: unknown
  ) => Array<{ json: { conversation_id: string } }>;

  assert.ok(workflow.nodes.some((candidate) => candidate.type === 'n8n-nodes-base.scheduleTrigger'));
  assert.match(serialized, /RECONCILIATION_LOOKBACK_MINUTES/);
  assert.match(serialized, /RECONCILIATION_INTERVAL_MINUTES/);
  assert.match(serialized, /call_start_after_unix/);
  assert.match(serialized, /call_start_before_unix/);
  assert.match(serialized, /next_cursor/);
  assert.match(serialized, /has_more/);
  assert.deepEqual(execute(lista).map((item) => item.json.conversation_id), [
    'conv-fixture-concluido-001',
    'conv-ja-persistido-002'
  ]);

  const filter = node(workflow, 'Manter somente ausentes');
  assert.equal(filter?.credentials?.postgres?.name, 'HQ GEAP PostgreSQL');
  assert.match(JSON.stringify(filter?.parameters), /not exists/i);
  assert.match(JSON.stringify(filter?.parameters), /elevenlabs_conversation_id/);
  assert.equal(
    workflow.connections['Há próxima página?']?.main[0]?.[0]?.node,
    'Preparar próxima página'
  );
  assert.equal(
    workflow.connections['Preparar próxima página']?.main[0]?.[0]?.node,
    'Listar Atendimentos ElevenLabs'
  );
});

test('webhook, reconciliacao e Buscar Conversa convergem para a ingestao idempotente', async () => {
  const [reconciliacao, reprocessamento, webhook] = await Promise.all([
    loadWorkflow(reconciliacaoPath),
    loadWorkflow(reprocessamentoPath),
    loadWorkflow(webhookPath)
  ]);
  const workflows = [reconciliacao, reprocessamento];
  const fixture = JSON.parse(await readFile(detalheFixturePath, 'utf8')) as {
    data: Record<string, unknown>;
    normalized: Record<string, unknown>;
  };

  for (const workflow of workflows) {
    const serialized = JSON.stringify(workflow);
    const buscar = node(workflow, 'Buscar Conversa ElevenLabs');
    const persistir = node(workflow, 'Persistir Atendimento');
    const normalizarCode = node(workflow, 'Contrato normalizado')?.parameters.jsCode ?? '';
    const normalizar = new Function('$json', '$env', normalizarCode) as (
      input: unknown,
      environment: unknown
    ) => Array<{ json: Record<string, unknown> }>;
    const generated = normalizar(fixture.data, {
      ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number'
    })[0]!.json;

    assert.equal(buscar?.credentials?.httpHeaderAuth?.name, 'ElevenLabs API Key');
    assert.equal(persistir?.credentials?.httpHeaderAuth?.name, 'HQ Ingestion API Key');
    assert.match(JSON.stringify(buscar?.parameters), /\/v1\/convai\/conversations\//);
    assert.match(JSON.stringify(persistir?.parameters), /\/atendimentos\/ingestao/);
    assert.equal(persistir?.parameters.body, '={{ JSON.stringify($json) }}');
    assert.deepEqual(generated, { ...fixture.normalized, audio_reference: null });
    assert.doesNotMatch(serialized, /xi-api-key["']?\s*[:=]\s*["'][^={]/i);
    assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
  }

  const webhookPersistence = node(webhook, 'Persistir Atendimento');
  assert.equal(
    webhookPersistence?.credentials?.httpHeaderAuth?.name,
    'HQ Ingestion API Key'
  );
  assert.match(
    JSON.stringify(webhookPersistence?.parameters),
    /\/atendimentos\/ingestao/
  );
  assert.equal(webhookPersistence?.parameters.body, '={{ JSON.stringify($json) }}');
  assert.ok(
    reprocessamento.nodes.some(
      (candidate) => candidate.type === 'n8n-nodes-base.formTrigger'
    )
  );
});
