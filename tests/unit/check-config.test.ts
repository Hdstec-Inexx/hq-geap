import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAppConfig } from '../../apps/api/src/check-config.js';

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
