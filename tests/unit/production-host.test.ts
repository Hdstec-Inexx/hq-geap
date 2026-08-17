import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAppConfig } from '../../apps/api/src/plugins/config.js';

const productionEnv = {
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

test('em producao o HOST padrao escuta em 0.0.0.0 para proxy do Easypanel', () => {
  const config = parseAppConfig(productionEnv);
  assert.equal(config.HOST, '0.0.0.0');
});

test('HOST explicito continua respeitado em producao', () => {
  const config = parseAppConfig({ ...productionEnv, HOST: '127.0.0.1' });
  assert.equal(config.HOST, '127.0.0.1');
});

test('em desenvolvimento o HOST padrao permanece 127.0.0.1', () => {
  const config = parseAppConfig({
    ...productionEnv,
    NODE_ENV: 'development',
    STORAGE_PROVIDER: 'public'
  });
  assert.equal(config.HOST, '127.0.0.1');
});
