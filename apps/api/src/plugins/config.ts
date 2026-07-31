import fp from 'fastify-plugin';
import { z } from 'zod';
import { loadEnvironment } from '../environment.js';

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().optional()
    ),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .default('postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    JWT_SECRET: z.string().min(32).default('development-only-secret-change-me'),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(28_800),
    INGESTION_API_KEY: z
      .string()
      .min(32)
      .default('development-ingestion-key-change-me'),
    STORAGE_PROVIDER: z.enum(['public', 'minio', 'gcs']).default('public'),
    STORAGE_BUCKET: z.string().trim().min(1).default('hq-geap-audio'),
    STORAGE_PUBLIC_URL: z.url().default('http://127.0.0.1:9000/hq-geap-audio'),
    STORAGE_ENDPOINT: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.url().optional()
    ),
    STORAGE_ACCESS_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().trim().min(1).optional()
    ),
    STORAGE_SECRET_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().trim().min(1).optional()
    ),
    ELEVENLABS_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().trim().min(1).optional()
    ),
    ELEVENLABS_API_URL: z.url().default('https://api.elevenlabs.io')
  })
  .superRefine((config, context) => {
    if (
      config.NODE_ENV === 'production' &&
      config.JWT_SECRET === 'development-only-secret-change-me'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be configured in production'
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.INGESTION_API_KEY === 'development-ingestion-key-change-me'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['INGESTION_API_KEY'],
        message: 'INGESTION_API_KEY must be configured in production'
      });
    }
    if (config.NODE_ENV === 'production' && !config.ELEVENLABS_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['ELEVENLABS_API_KEY'],
        message:
          'ELEVENLABS_API_KEY must be configured in production for Monitoramento ao Vivo'
      });
    }
    if (config.NODE_ENV === 'production' && config.STORAGE_PROVIDER === 'public') {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_PROVIDER'],
        message: 'A signed storage provider must be configured in production'
      });
    }
    if (
      config.STORAGE_PROVIDER === 'minio' &&
      (!config.STORAGE_ENDPOINT ||
        !config.STORAGE_ACCESS_KEY ||
        !config.STORAGE_SECRET_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_PROVIDER'],
        message: 'MinIO endpoint and credentials are required'
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.STORAGE_PROVIDER === 'minio' &&
      config.STORAGE_ENDPOINT &&
      new URL(config.STORAGE_ENDPOINT).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_ENDPOINT'],
        message: 'MinIO must use HTTPS in production'
      });
    }
  })
  .transform((config) => ({
    ...config,
    HOST:
      config.HOST ??
      (config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
  }));

export type AppConfig = z.infer<typeof configSchema>;

export function parseAppConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return configSchema.parse(env);
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export default fp(
  async (app) => {
    loadEnvironment();
    app.decorate('config', parseAppConfig(process.env));
  },
  { name: 'config' }
);
