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
  continueOnFail?: boolean;
  retryOnFail?: boolean;
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
  const agregarCode = node(workflow, 'Agregar candidatos')?.parameters.jsCode ?? '';
  const agregar = new Function('$input', agregarCode) as (input: {
    all: () => Array<{ json: { conversation_id: string } }>;
  }) => Array<{ json: { conversation_ids: string[] } }>;

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
  assert.deepEqual(
    agregar({
      all: () => execute(lista)
    })[0]?.json.conversation_ids,
    ['conv-fixture-concluido-001', 'conv-ja-persistido-002']
  );

  const filter = node(workflow, 'Manter somente ausentes');
  assert.equal(filter?.credentials?.postgres?.name, 'HQ GEAP PostgreSQL');
  assert.match(JSON.stringify(filter?.parameters), /unnest/i);
  assert.match(JSON.stringify(filter?.parameters), /not exists/i);
  assert.match(JSON.stringify(filter?.parameters), /elevenlabs_conversation_id/);
  assert.equal(
    workflow.connections['Extrair Atendimentos concluídos']?.main[0]?.[0]?.node,
    'Agregar candidatos'
  );
  assert.equal(
    workflow.connections['Há próxima página?']?.main[0]?.[0]?.node,
    'Preparar próxima página'
  );
  assert.equal(
    workflow.connections['Preparar próxima página']?.main[0]?.[0]?.node,
    'Listar Atendimentos ElevenLabs'
  );

  for (const name of [
    'Buscar Conversa ElevenLabs',
    'Contrato normalizado',
    'Persistir Atendimento'
  ] as const) {
    assert.equal(node(workflow, name)?.continueOnFail, true);
  }
  assert.equal(node(workflow, 'Listar Atendimentos ElevenLabs')?.retryOnFail, true);
});

test('os tres fluxos persistem audio opcional com chave flat e content-type de MP3', async () => {
  const [webhook, reconciliacao, reprocessamento] = await Promise.all([
    loadWorkflow(webhookPath),
    loadWorkflow(reconciliacaoPath),
    loadWorkflow(reprocessamentoPath)
  ]);
  const fixture = JSON.parse(await readFile(detalheFixturePath, 'utf8')) as {
    data: Record<string, any>;
  };

  for (const workflow of [webhook, reconciliacao, reprocessamento]) {
    const serialized = JSON.stringify(workflow);
    const download = node(workflow, 'Baixar áudio ElevenLabs');
    const setContentType = node(workflow, 'Definir Content-Type do áudio');
    const upload = node(workflow, 'Armazenar áudio');
    const hasAudio = node(workflow, 'Possui áudio?');
    const downloaded = node(workflow, 'Áudio baixado?');
    const prepare = node(workflow, 'Preparar contrato API');

    assert.ok(download, 'workflow deve baixar o áudio da ElevenLabs');
    assert.ok(setContentType, 'workflow deve definir o metadata MIME do binário');
    assert.ok(upload, 'workflow deve subir o áudio no S3/MinIO');
    assert.ok(hasAudio, 'workflow deve tratar áudio ausente sem falhar');
    assert.ok(downloaded, 'workflow deve ignorar falha no download');
    assert.ok(prepare, 'workflow deve preparar o contrato mesmo sem áudio');
    assert.equal(download?.continueOnFail, true);
    assert.equal(upload?.continueOnFail, true);
    assert.equal(upload?.retryOnFail, true);
    assert.equal(upload?.parameters.bucketName, '={{ $env.STORAGE_BUCKET }}');
    assert.equal(upload?.parameters.binaryPropertyName, 'data');
    assert.equal(upload?.credentials?.s3?.name, 'HQ Audio Storage');
    assert.equal(
      upload?.parameters.fileName,
      "={{ $('Contrato normalizado').item.json.audio_object_key }}"
    );
    assert.match(serialized, /audio\/mpeg/);

    const normalizedCode = node(workflow, 'Contrato normalizado')?.parameters.jsCode ?? '';
    const normalize = new Function('$json', '$env', normalizedCode) as (
      input: unknown,
      environment: unknown
    ) => Array<{ json: Record<string, unknown> }>;
    const normalized = normalize(
      workflow === webhook
        ? { event: { type: 'post_call_transcription', event_timestamp: 1, data: fixture.data } }
        : fixture.data,
      { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
    )[0]!.json;
    assert.equal(normalized.audio_object_key, 'conv-fixture-concluido-001.mp3');

    const prepareCode = prepare?.parameters.jsCode ?? '';
    const prepareContract = new Function('$items', '$json', prepareCode) as (
      items: (name: string) => Array<{ json: Record<string, unknown> }>,
      item: Record<string, unknown>
    ) => Array<{ json: Record<string, unknown> }>;
    const withoutUpload = prepareContract(
      (name) => name === 'Contrato normalizado' ? [{ json: normalized }] : [],
      normalized
    )[0]!.json;
    const withFailedUpload = prepareContract(
      (name) => name === 'Contrato normalizado' ? [{ json: normalized }] : [],
      { error: 'bucket indisponível' }
    )[0]!.json;
    const withSuccessfulUpload = prepareContract(
      (name) => name === 'Contrato normalizado' ? [{ json: normalized }] : [],
      { success: true }
    )[0]!.json;

    assert.equal(withoutUpload.audio_reference, null);
    assert.equal(withFailedUpload.audio_reference, null);
    assert.equal(withSuccessfulUpload.audio_reference, normalized.audio_object_key);
  }
});

test('o node de content-type preserva o Atendimento quando o download não retorna binário', async () => {
  const [webhook, reconciliacao, reprocessamento] = await Promise.all([
    loadWorkflow(webhookPath),
    loadWorkflow(reconciliacaoPath),
    loadWorkflow(reprocessamentoPath)
  ]);

  for (const workflow of [webhook, reconciliacao, reprocessamento]) {
    const code = node(workflow, 'Definir Content-Type do áudio')?.parameters.jsCode ?? '';
    const execute = new Function('$input', code) as (input: {
      first: () => { json: Record<string, unknown>; binary?: Record<string, any> };
    }) => Array<{ json: Record<string, unknown>; binary?: Record<string, any> }>;
    const missingBinary = execute({ first: () => ({ json: { conversation_id: 'conv-audio-falhou' } }) });
    assert.deepEqual(missingBinary[0]?.json, {
      conversation_id: 'conv-audio-falhou',
      audio_downloaded: false
    });

    const withBinary = execute({
      first: () => ({
        json: { conversation_id: 'conv-audio-ok' },
        binary: { data: { fileName: 'audio', mimeType: 'application/octet-stream' } }
      })
    });
    assert.equal(withBinary[0]?.json.audio_downloaded, true);
    assert.equal(withBinary[0]?.binary?.data?.mimeType, 'audio/mpeg');
  }
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
    assert.equal(generated.tme_seconds, 11);
    const { has_audio, audio_object_key, ...contract } = generated;
    assert.equal(has_audio, true);
    assert.equal(audio_object_key, 'conv-fixture-concluido-001.mp3');
    assert.deepEqual(contract, {
      ...fixture.normalized,
      audio_reference: null
    });
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

  const skipFailure = node(reconciliacao, 'Contrato normalizado')?.parameters.jsCode ?? '';
  const skipNormalizar = new Function('$json', '$env', skipFailure) as (
    input: unknown,
    environment: unknown
  ) => unknown[];
  assert.deepEqual(
    skipNormalizar({ error: 'provider down' }, { ELEVENLABS_TRANSFER_TOOL_NAME: 'x' }),
    []
  );
});

function contratoNormalizado(workflow: Workflow) {
  const code = node(workflow, 'Contrato normalizado')?.parameters.jsCode ?? '';
  return new Function('$json', '$env', code) as (
    input: unknown,
    environment: unknown
  ) => Array<{ json: Record<string, unknown> }> | unknown[];
}

function detalheComTranscript(
  transcript: Array<Record<string, unknown>>
): Record<string, unknown> {
  return {
    conversation_id: 'conv-tme-parity',
    agent_id: 'agent-livia-test',
    status: 'done',
    transcript,
    metadata: {
      start_time_unix_secs: 1785330000,
      call_duration_secs: 60,
      cost_fiat: 0.1
    },
    analysis: { data_collection_results: {} }
  };
}

test('reconciliacao e reprocessar derivam Tempo de Espera como cliente → 2ª fala do agente', async () => {
  const [reconciliacao, reprocessamento] = await Promise.all([
    loadWorkflow(reconciliacaoPath),
    loadWorkflow(reprocessamentoPath)
  ]);

  for (const workflow of [reconciliacao, reprocessamento]) {
    const normalizar = contratoNormalizado(workflow);
    const generated = (
      normalizar(
        detalheComTranscript([
          { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
          { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 5 },
          { role: 'agent', message: 'Claro, como posso ajudar?', time_in_call_secs: 9 }
        ]),
        { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
      ) as Array<{ json: Record<string, unknown> }>
    )[0]!.json;

    assert.equal(generated.tme_seconds, 4);
    assert.equal(Object.hasOwn(generated, 'tme'), false);
    assert.equal(Object.hasOwn(generated, 'sla'), false);
    assert.equal(Object.hasOwn(generated, 'sla_percent'), false);
  }
});

test('reconciliacao e reprocessar gravam null sem regressão à primeira fala do agente', async () => {
  const [reconciliacao, reprocessamento] = await Promise.all([
    loadWorkflow(reconciliacaoPath),
    loadWorkflow(reprocessamentoPath)
  ]);

  for (const workflow of [reconciliacao, reprocessamento]) {
    const normalizar = contratoNormalizado(workflow);
    const onlyPresentation = (
      normalizar(
        detalheComTranscript([
          { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 }
        ]),
        { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
      ) as Array<{ json: Record<string, unknown> }>
    )[0]!.json;
    const withoutSecondAgent = (
      normalizar(
        detalheComTranscript([
          { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
          { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 5 }
        ]),
        { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
      ) as Array<{ json: Record<string, unknown> }>
    )[0]!.json;

    assert.equal(onlyPresentation.tme_seconds, null);
    assert.equal(withoutSecondAgent.tme_seconds, null);

    const negativeInterval = (
      normalizar(
        detalheComTranscript([
          { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
          { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: 12 },
          { role: 'agent', message: 'Claro.', time_in_call_secs: 9 }
        ]),
        { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
      ) as Array<{ json: Record<string, unknown> }>
    )[0]!.json;
    const nonFinite = (
      normalizar(
        detalheComTranscript([
          { role: 'agent', message: 'Olá, eu sou a Lívia.', time_in_call_secs: 0 },
          { role: 'user', message: 'Preciso de ajuda.', time_in_call_secs: Number.NaN },
          { role: 'agent', message: 'Claro.', time_in_call_secs: 9 }
        ]),
        { ELEVENLABS_TRANSFER_TOOL_NAME: 'transfer_to_number' }
      ) as Array<{ json: Record<string, unknown> }>
    )[0]!.json;

    assert.equal(negativeInterval.tme_seconds, null);
    assert.equal(nonFinite.tme_seconds, null);
  }
});

test('reconciliacao e reprocessar não materializam TME nem SLA no contrato', async () => {
  const [reconciliacao, reprocessamento] = await Promise.all([
    loadWorkflow(reconciliacaoPath),
    loadWorkflow(reprocessamentoPath)
  ]);

  for (const workflow of [reconciliacao, reprocessamento]) {
    const code = node(workflow, 'Contrato normalizado')?.parameters.jsCode ?? '';
    assert.doesNotMatch(code, /\bSLA\b/);
    assert.doesNotMatch(code, /\btme_medio\b/i);
    assert.doesNotMatch(code, /\bsla_/i);
    assert.match(code, /tme_seconds/);
  }
});
