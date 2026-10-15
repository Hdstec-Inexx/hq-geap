import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import storagePlugin, {
  isAudioHistorical,
  isNotFoundError,
  type StorageClient
} from '../../apps/api/src/plugins/storage.js';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const fastify = apiRequire('fastify');
const Fastify = fastify.default ?? fastify;
const fp = apiRequire('fastify-plugin');
const fastifyPlugin = fp.default ?? fp;

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
      const prefix = config.urlPrefix ?? `https://storage.test/${bucket}`;
      return `${prefix}/${objectName}?expires=${expires ?? 900}`;
    }
  };

  return { client, statCalls, presignedCalls };
}

function buildTestApp(options: {
  configOverrides?: Record<string, any>;
  primaryClient?: StorageClient;
  r2Client?: StorageClient;
  now?: () => number;
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
    ...options.configOverrides
  };

  app.register(
    fastifyPlugin(
      async (instance: any) => {
        instance.decorate('config', baseConfig);
      },
      { name: 'config' }
    )
  );

  app.register(storagePlugin, {
    primaryClient: options.primaryClient,
    r2Client: options.r2Client,
    now: options.now
  });

  return { app, warnings };
}

test('isAudioHistorical identifica atendimentos com menos de 30 dias e com 30 dias ou mais', () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();

  // 10 dias atrás (< 30 dias) -> falso
  const tenDaysAgo = new Date('2026-10-05T12:00:00.000Z');
  assert.equal(isAudioHistorical(tenDaysAgo, fixedNow), false);

  // 29 dias e 23 horas atrás (< 30 dias) -> falso
  const almostThirtyDays = new Date(fixedNow - (30 * 24 * 60 * 60 * 1000 - 1000));
  assert.equal(isAudioHistorical(almostThirtyDays, fixedNow), false);

  // Exatamente 30 dias atrás (>= 30 dias) -> verdadeiro
  const exactlyThirtyDays = new Date(fixedNow - 30 * 24 * 60 * 60 * 1000);
  assert.equal(isAudioHistorical(exactlyThirtyDays, fixedNow), true);

  // 45 dias atrás (>= 30 dias) -> verdadeiro
  const fortyFiveDaysAgo = new Date('2026-08-31T12:00:00.000Z');
  assert.equal(isAudioHistorical(fortyFiveDaysAgo, fixedNow), true);

  // Aceita string ISO
  assert.equal(isAudioHistorical('2026-08-31T12:00:00.000Z', fixedNow), true);
  assert.equal(isAudioHistorical('2026-10-05T12:00:00.000Z', fixedNow), false);

  // Data nula, indefinida ou inválida recai para falso (< 30 dias)
  assert.equal(isAudioHistorical(null, fixedNow), false);
  assert.equal(isAudioHistorical(undefined, fixedNow), false);
  assert.equal(isAudioHistorical('invalid-date', fixedNow), false);
});

test('retorna null imediatamente sem consultar storages se a referencia de audio for nula ou vazia', async () => {
  const primary = createMockClient({ existingFiles: ['conv-1.mp3'] });
  const r2 = createMockClient({ existingFiles: ['conv-1.mp3'] });
  const { app } = buildTestApp({ primaryClient: primary.client, r2Client: r2.client });
  await app.ready();

  const urlNull = await app.storage.resolveAudioUrl(null);
  const urlEmpty = await app.storage.resolveAudioUrl('');

  assert.equal(urlNull, null);
  assert.equal(urlEmpty, null);
  assert.equal(primary.statCalls.length, 0);
  assert.equal(r2.statCalls.length, 0);
});

test('atendimento recente (< 30 dias) presente no S3 primario: resolve S3 e nao invoca R2', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const recentDate = new Date('2026-10-10T12:00:00.000Z'); // 5 dias atrás

  const primary = createMockClient({
    existingFiles: ['conv-recente.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2 = createMockClient({
    existingFiles: ['conv-recente.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  const url = await app.storage.resolveAudioUrl('conv-recente.mp3', recentDate);

  assert.match(url ?? '', /^https:\/\/s3\.primary\.example\.com\/hq-geap-primary\/conv-recente\.mp3/);
  assert.equal(primary.statCalls.length, 1);
  assert.equal(primary.statCalls[0]?.objectName, 'conv-recente.mp3');
  assert.equal(primary.presignedCalls.length, 1);
  assert.equal(primary.presignedCalls[0]?.expires, 900); // 15 minutos
  assert.equal(r2.statCalls.length, 0); // R2 não deve ser invocado
  assert.equal(r2.presignedCalls.length, 0);
});

test('atendimento recente (< 30 dias) ausente no S3 (404), mas presente no R2: fallback para R2', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const recentDate = new Date('2026-10-10T12:00:00.000Z');

  const primary = createMockClient({ existingFiles: [] }); // 404 no S3
  const r2 = createMockClient({
    existingFiles: ['conv-migrado-cedo.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  const url = await app.storage.resolveAudioUrl('conv-migrado-cedo.mp3', recentDate);

  assert.match(url ?? '', /^https:\/\/r2\.example\.com\/hq-geap-cold\/conv-migrado-cedo\.mp3/);
  assert.equal(primary.statCalls.length, 1); // Tentou S3 primeiro
  assert.equal(primary.presignedCalls.length, 0);
  assert.equal(r2.statCalls.length, 1); // Caiu no R2
  assert.equal(r2.presignedCalls.length, 1);
  assert.equal(r2.presignedCalls[0]?.expires, 900);
});

test('atendimento historico (>= 30 dias) presente no R2: resolve R2 e nao invoca S3', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const historicalDate = new Date('2026-08-01T12:00:00.000Z'); // > 70 dias atrás

  const primary = createMockClient({
    existingFiles: ['conv-historico.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2 = createMockClient({
    existingFiles: ['conv-historico.mp3'],
    urlPrefix: 'https://r2.example.com/hq-geap-cold'
  });

  const { app } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  const url = await app.storage.resolveAudioUrl('conv-historico.mp3', historicalDate);

  assert.match(url ?? '', /^https:\/\/r2\.example\.com\/hq-geap-cold\/conv-historico\.mp3/);
  assert.equal(r2.statCalls.length, 1);
  assert.equal(r2.statCalls[0]?.objectName, 'conv-historico.mp3');
  assert.equal(r2.presignedCalls.length, 1);
  assert.equal(r2.presignedCalls[0]?.expires, 900);
  assert.equal(primary.statCalls.length, 0); // S3 não deve ser invocado
  assert.equal(primary.presignedCalls.length, 0);
});

test('atendimento historico (>= 30 dias) ausente no R2 (404), mas presente no S3: fallback para S3', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const historicalDate = new Date('2026-08-01T12:00:00.000Z');

  const primary = createMockClient({
    existingFiles: ['conv-atraso-migracao.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });
  const r2 = createMockClient({ existingFiles: [] }); // 404 no R2

  const { app } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  const url = await app.storage.resolveAudioUrl('conv-atraso-migracao.mp3', historicalDate);

  assert.match(url ?? '', /^https:\/\/s3\.primary\.example\.com\/hq-geap-primary\/conv-atraso-migracao\.mp3/);
  assert.equal(r2.statCalls.length, 1); // Tentou R2 primeiro
  assert.equal(r2.presignedCalls.length, 0);
  assert.equal(primary.statCalls.length, 1); // Caiu no S3
  assert.equal(primary.presignedCalls.length, 1);
  assert.equal(primary.presignedCalls[0]?.expires, 900);
});

test('falha de rede ou 5xx no storage prioritario falha rapidamente sem acionar o alternativo (recente)', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const recentDate = new Date('2026-10-10T12:00:00.000Z');

  const networkErr = new Error('connect ECONNREFUSED 127.0.0.1:9000');
  (networkErr as any).code = 'ECONNREFUSED';

  const primary = createMockClient({
    statError: () => networkErr
  });
  const r2 = createMockClient({ existingFiles: ['conv-falha.mp3'] });

  const { app } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  await assert.rejects(
    async () => {
      await app.storage.resolveAudioUrl('conv-falha.mp3', recentDate);
    },
    (err: any) => err.code === 'ECONNREFUSED'
  );

  assert.equal(primary.statCalls.length, 1);
  assert.equal(r2.statCalls.length, 0); // R2 não pode ser acionado em erro 5xx/rede
});

test('falha de rede ou 5xx no storage prioritario falha rapidamente sem acionar o alternativo (historico)', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const historicalDate = new Date('2026-08-01T12:00:00.000Z');

  const serverErr = new Error('Internal Server Error');
  (serverErr as any).statusCode = 500;
  (serverErr as any).code = 'InternalError';

  const primary = createMockClient({ existingFiles: ['conv-falha-hist.mp3'] });
  const r2 = createMockClient({
    statError: () => serverErr
  });

  const { app } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  await assert.rejects(
    async () => {
      await app.storage.resolveAudioUrl('conv-falha-hist.mp3', historicalDate);
    },
    (err: any) => err.statusCode === 500
  );

  assert.equal(r2.statCalls.length, 1);
  assert.equal(primary.statCalls.length, 0); // S3 primário não pode ser acionado
});

test('retorna null com log de advertencia (warn) quando o objeto nao existe em nenhum storage', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const recentDate = new Date('2026-10-10T12:00:00.000Z');

  const primary = createMockClient({ existingFiles: [] });
  const r2 = createMockClient({ existingFiles: [] });

  const { app, warnings } = buildTestApp({
    primaryClient: primary.client,
    r2Client: r2.client,
    now: () => fixedNow
  });
  await app.ready();

  const url = await app.storage.resolveAudioUrl('conv-inexistente.mp3', recentDate);

  assert.equal(url, null);
  assert.equal(primary.statCalls.length, 1);
  assert.equal(r2.statCalls.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]?.msg ?? '', /Audio not found in storage/i);
});

test('quando R2 nao esta configurado no ambiente, resolve exclusivamente pelo storage primario', async () => {
  const fixedNow = new Date('2026-10-15T12:00:00.000Z').getTime();
  const historicalDate = new Date('2026-08-01T12:00:00.000Z');

  const primary = createMockClient({
    existingFiles: ['conv-single-storage.mp3'],
    urlPrefix: 'https://s3.primary.example.com/hq-geap-primary'
  });

  // Configuração sem R2
  const { app, warnings } = buildTestApp({
    configOverrides: {
      R2_ENDPOINT: undefined,
      R2_BUCKET: undefined,
      R2_ACCESS_KEY: undefined,
      R2_SECRET_KEY: undefined
    },
    primaryClient: primary.client,
    now: () => fixedNow
  });
  await app.ready();

  // Histórico deve ir para o primário já que R2 não existe
  const url = await app.storage.resolveAudioUrl('conv-single-storage.mp3', historicalDate);

  assert.match(url ?? '', /^https:\/\/s3\.primary\.example\.com\/hq-geap-primary\/conv-single-storage\.mp3/);
  assert.equal(primary.statCalls.length, 1);

  // E se for 404 no primário sem R2, retorna null com warn sem crashar
  const url404 = await app.storage.resolveAudioUrl('conv-inexistente.mp3', historicalDate);
  assert.equal(url404, null);
  assert.equal(warnings.length, 1);
});

test('isNotFoundError reconhece erros 404, NotFound e NoSuchKey de S3 e R2', () => {
  const notFoundError = new Error('Not Found');
  (notFoundError as any).code = 'NotFound';
  assert.equal(isNotFoundError(notFoundError), true);

  const noSuchKeyError = new Error('The specified key does not exist.');
  (noSuchKeyError as any).code = 'NoSuchKey';
  assert.equal(isNotFoundError(noSuchKeyError), true);

  const status404Error = new Error('Not found by status');
  (status404Error as any).statusCode = 404;
  assert.equal(isNotFoundError(status404Error), true);

  const internalError = new Error('Internal Server Error');
  (internalError as any).statusCode = 500;
  (internalError as any).code = 'InternalError';
  assert.equal(isNotFoundError(internalError), false);

  const netError = new Error('connect ECONNREFUSED');
  (netError as any).code = 'ECONNREFUSED';
  assert.equal(isNotFoundError(netError), false);
});

test('instanciacao real do cliente Cloudflare R2 com MinioClient a partir de configuracoes validadas', async () => {
  const app = Fastify({ logger: false });
  app.register(
    fastifyPlugin(
      async (instance: any) => {
        instance.decorate('config', {
          STORAGE_PROVIDER: 'minio' as const,
          STORAGE_ENDPOINT: 'https://s3.primary.example.com',
          STORAGE_BUCKET: 'hq-geap-primary',
          STORAGE_ACCESS_KEY: 'primary-key',
          STORAGE_SECRET_KEY: 'primary-secret',
          STORAGE_PUBLIC_URL: 'https://s3.primary.example.com/hq-geap-primary',
          R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
          R2_BUCKET: 'hq-geap-cold',
          R2_ACCESS_KEY: 'r2-access-key-123',
          R2_SECRET_KEY: 'r2-secret-key-456'
        });
      },
      { name: 'config' }
    )
  );

  await app.register(storagePlugin);
  await app.ready();

  // O decorator storage foi registrado com sucesso
  assert.equal(typeof app.storage.resolveAudioUrl, 'function');
});
