import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAppConfig } from '../../apps/api/src/check-config.js';
import { parseAppConfig } from '../../apps/api/src/plugins/config.js';

const validProductionEnv = {
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: 'postgres://hq_geap:hq_geap@db:5432/hq_geap',
  CORS_ORIGIN: 'https://hq.example.com',
  JWT_SECRET: 'production-secret-with-at-least-32-chars',
  JWT_EXPIRES_IN_SECONDS: '28800',
  INGESTION_API_KEY: 'production-ingestion-key-with-32chars',
  STORAGE_PROVIDER: 'minio',
  STORAGE_BUCKET: 'hq-geap',
  STORAGE_PUBLIC_URL: 'https://storage.example.com/hq-geap',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_ACCESS_KEY: 'access',
  STORAGE_SECRET_KEY: 'secret',
  ELEVENLABS_API_KEY: 'sk_test_monitoramento'
} as const;

test('checkAppConfig aceita env de producao completa', () => {
  const result = checkAppConfig(validProductionEnv);
  assert.equal(result.ok, true);
});

test('checkAppConfig rejeita STORAGE_PROVIDER=public em producao com mensagem clara', () => {
  const result = checkAppConfig({
    ...validProductionEnv,
    STORAGE_PROVIDER: 'public'
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /STORAGE_PROVIDER/);
    assert.match(result.message, /signed storage provider/i);
  }
});

test('checkAppConfig rejeita JWT_SECRET curto antes do migrate', () => {
  const result = checkAppConfig({
    ...validProductionEnv,
    JWT_SECRET: 'curto'
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /JWT_SECRET/);
  }
});

test('checkAppConfig e parseAppConfig aceitam configuracao completa do Cloudflare R2 com HTTPS', () => {
  const envWithR2 = {
    ...validProductionEnv,
    R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
    R2_BUCKET: 'hq-geap-cold',
    R2_ACCESS_KEY: 'r2-access-key-123',
    R2_SECRET_KEY: 'r2-secret-key-456'
  };
  const result = checkAppConfig(envWithR2);
  assert.equal(result.ok, true);

  const parsed = parseAppConfig(envWithR2);
  assert.equal(parsed.R2_ENDPOINT, 'https://test-account.r2.cloudflarestorage.com');
  assert.equal(parsed.R2_BUCKET, 'hq-geap-cold');
  assert.equal(parsed.R2_ACCESS_KEY, 'r2-access-key-123');
  assert.equal(parsed.R2_SECRET_KEY, 'r2-secret-key-456');
});

test('checkAppConfig rejeita configuracao parcial de Cloudflare R2 quando faltam campos obrigatorios', () => {
  const partialR2Configs = [
    { R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com' },
    { R2_BUCKET: 'hq-geap-cold' },
    { R2_ACCESS_KEY: 'access-key' },
    { R2_SECRET_KEY: 'secret-key' },
    {
      R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
      R2_BUCKET: 'hq-geap-cold'
    }
  ];

  for (const partial of partialR2Configs) {
    const result = checkAppConfig({
      ...validProductionEnv,
      ...partial
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /R2_/);
    }
  }
});

test('checkAppConfig rejeita R2_ENDPOINT com protocolo inseguro HTTP', () => {
  const result = checkAppConfig({
    ...validProductionEnv,
    R2_ENDPOINT: 'http://test-account.r2.cloudflarestorage.com',
    R2_BUCKET: 'hq-geap-cold',
    R2_ACCESS_KEY: 'r2-access-key-123',
    R2_SECRET_KEY: 'r2-secret-key-456'
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /R2_ENDPOINT/);
    assert.match(result.message, /HTTPS/i);
  }
});

test('checkAppConfig e parseAppConfig operam normalmente em storage unico quando R2 esta ausente ou vazio', () => {
  const withoutR2Result = checkAppConfig(validProductionEnv);
  assert.equal(withoutR2Result.ok, true);

  const parsedWithoutR2 = parseAppConfig(validProductionEnv);
  assert.equal(parsedWithoutR2.R2_ENDPOINT, undefined);
  assert.equal(parsedWithoutR2.R2_BUCKET, undefined);
  assert.equal(parsedWithoutR2.R2_ACCESS_KEY, undefined);
  assert.equal(parsedWithoutR2.R2_SECRET_KEY, undefined);

  const envWithEmptyStrings = {
    ...validProductionEnv,
    R2_ENDPOINT: '',
    R2_BUCKET: '   ',
    R2_ACCESS_KEY: '',
    R2_SECRET_KEY: ''
  };
  const emptyStringsResult = checkAppConfig(envWithEmptyStrings);
  assert.equal(emptyStringsResult.ok, true);

  const parsedEmptyStrings = parseAppConfig(envWithEmptyStrings);
  assert.equal(parsedEmptyStrings.R2_ENDPOINT, undefined);
  assert.equal(parsedEmptyStrings.R2_BUCKET, undefined);
  assert.equal(parsedEmptyStrings.R2_ACCESS_KEY, undefined);
  assert.equal(parsedEmptyStrings.R2_SECRET_KEY, undefined);
});
