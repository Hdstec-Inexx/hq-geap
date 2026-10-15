import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import atendimentosRoutes from '../../apps/api/src/modules/atendimentos/routes.js';
import curadoriaRoutes from '../../apps/api/src/modules/curadoria/routes.js';
import storagePlugin, { type StorageClient } from '../../apps/api/src/plugins/storage.js';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const fastify = apiRequire('fastify');
const Fastify = fastify.default ?? fastify;
const fp = apiRequire('fastify-plugin');
const fastifyPlugin = fp.default ?? fp;
const sensible = apiRequire('@fastify/sensible');
const fastifySensible = sensible.default ?? sensible;

const FIXED_NOW = new Date('2026-10-15T12:00:00.000Z').getTime();
const RECENT_DATE = new Date('2026-10-05T12:00:00.000Z'); // 10 dias atras (< 30 dias)
const HISTORICAL_DATE = new Date('2026-08-15T12:00:00.000Z'); // 61 dias atras (>= 30 dias)

function createMockClient(config: {
  existingFiles?: string[];
  urlPrefix?: string;
  statError?: (objectName: string) => Error | undefined;
}) {
  const existing = new Set(config.existingFiles ?? []);
  const statCalls: Array<{ bucket: string; objectName: string }> = [];
  const presignedCalls: Array<{ bucket: string; objectName: string; expires?: number }> = [];

  const client: StorageClient = {
    async statObject(bucket: string, objectName: string) {
      statCalls.push({ bucket, objectName });
      const customErr = config.statError?.(objectName);
      if (customErr) {
        throw customErr;
      }
      if (existing.has(objectName)) {
        return { size: 4096 };
      }
      const notFoundErr = new Error(`Object ${objectName} not found`);
      (notFoundErr as any).code = 'NotFound';
      (notFoundErr as any).statusCode = 404;
      throw notFoundErr;
    },
    async presignedGetObject(bucket: string, objectName: string, expires?: number) {
      presignedCalls.push({ bucket, objectName, expires });
      const prefix = config.urlPrefix ?? 'https://storage.test';
      return `${prefix}/${objectName}?expires=${expires ?? 900}`;
    }
  };

  return { client, statCalls, presignedCalls };
}

interface TestAtendimentoRecord {
  id: string;
  conversationId: string;
  audioReference: string | null;
  concluidoEm: Date | null;
  iniciadoEm: Date | null;
}

function buildMockAtendimentoRow(record: TestAtendimentoRecord) {
  return {
    id: record.id,
    conversationId: record.conversationId,
    agenteVozId: '11111111-1111-4111-8111-111111111111',
    agenteVozNome: 'Lívia',
    agentId: 'agent-livia-test',
    status: record.concluidoEm ? 'concluido' : 'em_andamento',
    iniciadoEm: record.iniciadoEm,
    concluidoEm: record.concluidoEm,
    duracaoSegundos: 300,
    motivoContato: 'Financeiro/Boletos',
    houveTransferencia: false,
    custo: '0.1500',
    notaIa: '9.00',
    eventTimestamp: '1785330252',
    audioReference: record.audioReference,
    curadorId: null,
    curadorNome: null,
    curadoriaNota: null,
    curadoriaRealizadaEm: null,
    transcricao: []
  };
}

function buildTestApp(options: {
  records: TestAtendimentoRecord[];
  primaryClient: StorageClient;
  r2Client: StorageClient;
}) {
  const app = Fastify({ logger: false });
  const warnings: Array<{ obj: unknown; msg: string }> = [];

  app.log.warn = ((obj: unknown, msg?: string) => {
    warnings.push({ obj, msg: msg ?? '' });
  }) as any;

  const baseConfig = {
    STORAGE_PROVIDER: 'minio' as const,
    STORAGE_ENDPOINT: 'https://s3.primary.example.com',
    STORAGE_BUCKET: 'hq-geap-primary',
    STORAGE_ACCESS_KEY: 'primary-key',
    STORAGE_SECRET_KEY: 'primary-secret',
    STORAGE_PUBLIC_URL: 'https://s3.primary.example.com/hq-geap-primary',
    R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
    R2_BUCKET: 'hq-geap-cold',
    R2_ACCESS_KEY: 'r2-access-key',
    R2_SECRET_KEY: 'r2-secret-key',
    INGESTION_API_KEY: 'test-ingestion-key'
  };

  app.register(
    fastifyPlugin(
      async (instance: any) => {
        instance.decorate('config', baseConfig);
      },
      { name: 'config' }
    )
  );

  const mockDb = {
    async query(sql: string, params: unknown[] = []) {
      const normalizedSql = sql.toLowerCase();

      // Atendimento query by ID
      if (normalizedSql.includes('from atendimentos') && normalizedSql.includes('a.id = $1')) {
        const id = params[0];
        const record = options.records.find((r) => r.id === id);
        if (!record) return { rows: [] };
        return { rows: [buildMockAtendimentoRow(record)] };
      }

      // Atendimento query by conversationId
      if (normalizedSql.includes('from atendimentos') && normalizedSql.includes('elevenlabs_conversation_id = $1')) {
        const conversationId = params[0];
        const record = options.records.find((r) => r.conversationId === conversationId);
        if (!record) return { rows: [] };
        return { rows: [buildMockAtendimentoRow(record)] };
      }

      // Curadoria avaliacoes IA query
      if (normalizedSql.includes('from avaliacoes a') && normalizedSql.includes("a.autor = 'ia'")) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              atendimentoId: params[0],
              nota: '9.00',
              notaQualidade: '9.00',
              atendimentoAprovado: true,
              falhasIdentificadas: [],
              resumoAtendimento: 'Resumo teste',
              promptVersao: 1,
              criadoEm: new Date('2026-10-05T12:05:00.000Z'),
              saudacaoEIntencao: true,
              solicitouCpf: true,
              informouProtocoloEmail: true,
              resolveuSolicitacao: true,
              validouEmailPorExtenso: true,
              semDiminutivos: true,
              encerramentoGeap: true,
              usoCorretoFerramentas: true
            }
          ]
        };
      }

      // Curadoria avaliacoes curador query
      if (normalizedSql.includes('from avaliacoes_curador')) {
        return { rows: [] };
      }

      // Checklists queries
      if (normalizedSql.includes('from avaliacoes_checklist')) {
        return { rows: [] };
      }

      // Favoritos query
      if (normalizedSql.includes('from favoritos')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
    async connect() {
      throw new Error('Not implemented in mockDb');
    }
  };

  app.decorate('db', mockDb);

  app.register(fastifySensible);

  app.register(storagePlugin, {
    primaryClient: options.primaryClient,
    r2Client: options.r2Client,
    now: () => FIXED_NOW
  });

  // Mock authentication hook so authUser is populated
  app.addHook('onRequest', async (request: any) => {
    request.authUser = {
      id: 'admin-user-id',
      email: 'admin@hq.test',
      role: 'admin',
      nome: 'Admin Teste'
    };
  });

  app.register(atendimentosRoutes);
  app.register(curadoriaRoutes);

  return { app, warnings };
}

test('GET /atendimentos/:id resolve audio recente (< 30 dias) via storage primario S3', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/recente.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/recente.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000001',
        conversationId: 'conv-recente',
        audioReference: 'atendimentos/recente.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: RECENT_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000001'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.audioUrl?.startsWith('https://s3.primary.example.com/hq-geap-primary/atendimentos/recente.mp3'),
    `Esperava URL do S3 primario, recebeu: ${body.audioUrl}`
  );
  assert.equal(primaryMock.statCalls.length, 1);
  assert.equal(r2Mock.statCalls.length, 0, 'Nao deve acionar R2 para atendimento recente');
});

test('GET /atendimentos/:id resolve audio historico (>= 30 dias) via storage R2', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/historico.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/historico.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000002',
        conversationId: 'conv-historico',
        audioReference: 'atendimentos/historico.mp3',
        concluidoEm: HISTORICAL_DATE,
        iniciadoEm: HISTORICAL_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000002'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.audioUrl?.startsWith('https://r2.example.com/hq-geap-cold/atendimentos/historico.mp3'),
    `Esperava URL do R2, recebeu: ${body.audioUrl}`
  );
  assert.equal(r2Mock.statCalls.length, 1);
  assert.equal(primaryMock.statCalls.length, 0, 'Nao deve acionar S3 quando presente no R2');
});

test('GET /atendimentos/:id usa iniciadoEm quando concluidoEm e nulo para determinar tiering', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/sem-concluido.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/sem-concluido.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000003',
        conversationId: 'conv-sem-concluido',
        audioReference: 'atendimentos/sem-concluido.mp3',
        concluidoEm: null,
        iniciadoEm: HISTORICAL_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000003'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.audioUrl?.startsWith('https://r2.example.com/hq-geap-cold/atendimentos/sem-concluido.mp3'),
    `Esperava URL do R2 com base em iniciadoEm historico, recebeu: ${body.audioUrl}`
  );
  assert.equal(r2Mock.statCalls.length, 1);
  assert.equal(primaryMock.statCalls.length, 0);
});

test('GET /atendimentos/:id trata falha no storage graciosamente (audioUrl null, log warn, sem 500)', async () => {
  const primaryMock = createMockClient({
    statError: () => new Error('Storage outage')
  });
  const r2Mock = createMockClient({
    statError: () => new Error('R2 outage')
  });

  const { app, warnings } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000004',
        conversationId: 'conv-falha',
        audioReference: 'atendimentos/falha.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: RECENT_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000004'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.audioUrl, null);
  assert.ok(warnings.some((w) => w.msg.includes('Failed to resolve Atendimento audio URL')));
});

test('GET /atendimentos/by-conversation/:conversationId resolve audio recente e historico', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/conv-rec.mp3', 'atendimentos/conv-hist.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/conv-rec.mp3', 'atendimentos/conv-hist.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '22222222-2222-4222-8222-000000000001',
        conversationId: 'conv-rec-01',
        audioReference: 'atendimentos/conv-rec.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: RECENT_DATE
      },
      {
        id: '22222222-2222-4222-8222-000000000002',
        conversationId: 'conv-hist-02',
        audioReference: 'atendimentos/conv-hist.mp3',
        concluidoEm: HISTORICAL_DATE,
        iniciadoEm: HISTORICAL_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  // 1. Recente -> S3
  const recentResponse = await app.inject({
    method: 'GET',
    url: '/atendimentos/by-conversation/conv-rec-01'
  });
  assert.equal(recentResponse.statusCode, 200);
  assert.ok(recentResponse.json().audioUrl?.startsWith('https://s3.primary.example.com/hq-geap-primary'));
  assert.equal(primaryMock.statCalls.length, 1);
  assert.equal(r2Mock.statCalls.length, 0);

  // 2. Historico -> R2
  const historicalResponse = await app.inject({
    method: 'GET',
    url: '/atendimentos/by-conversation/conv-hist-02'
  });
  assert.equal(historicalResponse.statusCode, 200);
  assert.ok(historicalResponse.json().audioUrl?.startsWith('https://r2.example.com/hq-geap-cold'));
  assert.equal(r2Mock.statCalls.length, 1);
  assert.equal(primaryMock.statCalls.length, 1); // 1 call from previous recent request, none from historical
});

test('GET /curadoria/:atendimentoId resolve audio recente e historico', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/curadoria-rec.mp3', 'atendimentos/curadoria-hist.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/curadoria-rec.mp3', 'atendimentos/curadoria-hist.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '33333333-3333-4333-8333-000000000001',
        conversationId: 'conv-cur-rec',
        audioReference: 'atendimentos/curadoria-rec.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: RECENT_DATE
      },
      {
        id: '33333333-3333-4333-8333-000000000002',
        conversationId: 'conv-cur-hist',
        audioReference: 'atendimentos/curadoria-hist.mp3',
        concluidoEm: HISTORICAL_DATE,
        iniciadoEm: HISTORICAL_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  // 1. Recente -> S3
  const recentResponse = await app.inject({
    method: 'GET',
    url: '/curadoria/33333333-3333-4333-8333-000000000001'
  });
  assert.equal(recentResponse.statusCode, 200);
  assert.ok(
    recentResponse.json().atendimento.audioUrl?.startsWith('https://s3.primary.example.com/hq-geap-primary'),
    `Esperava S3 para curadoria recente, obteve: ${recentResponse.json().atendimento.audioUrl}`
  );
  assert.equal(primaryMock.statCalls.length, 1);
  assert.equal(r2Mock.statCalls.length, 0);

  // 2. Historico -> R2
  const historicalResponse = await app.inject({
    method: 'GET',
    url: '/curadoria/33333333-3333-4333-8333-000000000002'
  });
  assert.equal(historicalResponse.statusCode, 200);
  assert.ok(
    historicalResponse.json().atendimento.audioUrl?.startsWith('https://r2.example.com/hq-geap-cold'),
    `Esperava R2 para curadoria historica, obteve: ${historicalResponse.json().atendimento.audioUrl}`
  );
  assert.equal(r2Mock.statCalls.length, 1);
  assert.equal(primaryMock.statCalls.length, 1); // 1 chamada da requisicao recente, nenhuma na historica
});

test('GET /curadoria/:atendimentoId trata falha de resolucao de audio sem retornar 500', async () => {
  const primaryMock = createMockClient({
    statError: () => new Error('S3 error')
  });
  const r2Mock = createMockClient({
    statError: () => new Error('R2 error')
  });

  const { app, warnings } = buildTestApp({
    records: [
      {
        id: '33333333-3333-4333-8333-000000000003',
        conversationId: 'conv-cur-err',
        audioReference: 'atendimentos/curadoria-err.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: RECENT_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const failureResponse = await app.inject({
    method: 'GET',
    url: '/curadoria/33333333-3333-4333-8333-000000000003'
  });
  assert.equal(failureResponse.statusCode, 200);
  assert.equal(failureResponse.json().atendimento.audioUrl, null);
  assert.ok(warnings.some((w) => w.msg.includes('Failed to resolve Atendimento audio URL')));
});

test('GET /atendimentos/:id realiza fallback cruzado quando audio historico falta no R2 mas existe no S3', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/fallback-s3.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: [], // ausente no R2
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000005',
        conversationId: 'conv-fallback-s3',
        audioReference: 'atendimentos/fallback-s3.mp3',
        concluidoEm: HISTORICAL_DATE,
        iniciadoEm: HISTORICAL_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000005'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.audioUrl?.startsWith('https://s3.primary.example.com/hq-geap-primary/atendimentos/fallback-s3.mp3'),
    `Esperava fallback para S3 primario, recebeu: ${body.audioUrl}`
  );
  assert.equal(r2Mock.statCalls.length, 1, 'Deve ter tentado R2 primeiro');
  assert.equal(primaryMock.statCalls.length, 1, 'Deve ter feito fallback para S3');
});

test('GET /atendimentos/:id realiza fallback cruzado quando audio recente falta no S3 mas existe no R2', async () => {
  const primaryMock = createMockClient({
    existingFiles: [], // ausente no S3
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/fallback-r2.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000006',
        conversationId: 'conv-fallback-r2',
        audioReference: 'atendimentos/fallback-r2.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: RECENT_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000006'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.audioUrl?.startsWith('https://r2.example.com/hq-geap-cold/atendimentos/fallback-r2.mp3'),
    `Esperava fallback para R2, recebeu: ${body.audioUrl}`
  );
  assert.equal(primaryMock.statCalls.length, 1, 'Deve ter tentado S3 primeiro');
  assert.equal(r2Mock.statCalls.length, 1, 'Deve ter feito fallback para R2');
});

test('GET /atendimentos/:id prioriza concluidoEm sobre iniciadoEm para resolucao de tiering', async () => {
  const primaryMock = createMockClient({
    existingFiles: ['atendimentos/prioridade.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2Mock = createMockClient({
    existingFiles: ['atendimentos/prioridade.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  // iniciadoEm era 61 dias atras, mas concluidoEm e recente (10 dias atras)
  const { app } = buildTestApp({
    records: [
      {
        id: '11111111-1111-4111-8111-000000000007',
        conversationId: 'conv-prioridade',
        audioReference: 'atendimentos/prioridade.mp3',
        concluidoEm: RECENT_DATE,
        iniciadoEm: HISTORICAL_DATE
      }
    ],
    primaryClient: primaryMock.client,
    r2Client: r2Mock.client
  });

  const response = await app.inject({
    method: 'GET',
    url: '/atendimentos/11111111-1111-4111-8111-000000000007'
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(
    body.audioUrl?.startsWith('https://s3.primary.example.com/hq-geap-primary/atendimentos/prioridade.mp3'),
    `Esperava S3 baseado em concluidoEm recente, recebeu: ${body.audioUrl}`
  );
  assert.equal(primaryMock.statCalls.length, 1);
  assert.equal(r2Mock.statCalls.length, 0);
});
