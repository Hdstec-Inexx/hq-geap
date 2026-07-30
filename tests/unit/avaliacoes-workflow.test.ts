import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL(
  '../../n8n/workflows/avaliar-atendimento.json',
  import.meta.url
);

type Workflow = {
  nodes: Array<{
    name: string;
    type: string;
    parameters: Record<string, unknown>;
    credentials?: Record<string, { id: string; name: string }>;
  }>;
};

test('workflow le a configuracao ativa, avalia no OpenRouter e persiste pela operacao transacional', async () => {
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8')) as Workflow;
  const serialized = JSON.stringify(workflow);
  const postgresNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.postgres');
  const openRouter = workflow.nodes.find((node) => node.name === 'Avaliar no OpenRouter');

  assert.match(serialized, /prompts_ia_avaliadora/);
  assert.match(serialized, /p\.ativo/);
  assert.match(serialized, /persistir_avaliacao_ia/);
  assert.match(serialized, /nao_se_aplica/);
  assert.equal(openRouter?.credentials?.httpHeaderAuth?.name, 'HQ GEAP OpenRouter');
  assert.ok(
    postgresNodes.every(
      (node) => node.credentials?.postgres?.name === 'HQ GEAP PostgreSQL'
    )
  );
  assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9_-]{10}/);
  assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//);
});
