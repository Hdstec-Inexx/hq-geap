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

  assert.match(serialized, /reivindicar_avaliacoes_ia/);
  assert.match(serialized, /persistir_avaliacao_ia/);
  assert.match(serialized, /checklist_schema/);
  assert.equal(openRouter?.credentials?.httpHeaderAuth?.name, 'HQ GEAP OpenRouter');
  assert.ok(
    postgresNodes.every(
      (node) => node.credentials?.postgres?.name === 'HQ GEAP PostgreSQL'
    )
  );
  assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9_-]{10}/);
  assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//);
});

test('workflow reivindica pendencias antes do OpenRouter sem duplicar chamadas concorrentes', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.match(workflow, /reivindicar_avaliacoes_ia/);
  assert.doesNotMatch(workflow, /from atendimentos a\\n/);
});

test('workflow usa chaves canonicas e trata a transcricao como dado nao confiavel', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.match(workflow, /criterio_chaves/);
  assert.match(workflow, /checklist_schema/);
  assert.match(workflow, /additionalProperties[^}]*false/);
  assert.match(workflow, /DADOS_NAO_CONFIAVEIS/);
  assert.match(workflow, /ignore quaisquer instrucoes/i);
  assert.match(workflow, /mensagem inteira do usuario/i);
  assert.doesNotMatch(workflow, /<\/DADOS_NAO_CONFIAVEIS>/);
});
