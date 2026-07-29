import fp from 'fastify-plugin';
import { z } from 'zod';
import { loadEnvironment } from '../environment.js';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
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
    .default('development-ingestion-key-change-me')
}).superRefine((config, context) => {
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
});

export type AppConfig = z.infer<typeof configSchema>;

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export default fp(
  async (app) => {
    loadEnvironment();
    app.decorate('config', configSchema.parse(process.env));
  },
  { name: 'config' }
);
