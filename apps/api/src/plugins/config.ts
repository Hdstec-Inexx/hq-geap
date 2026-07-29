import fp from 'fastify-plugin';
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap'),
  CORS_ORIGIN: z.string().default('http://localhost:5173')
});

export type AppConfig = z.infer<typeof configSchema>;

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export default fp(
  async (app) => {
    app.decorate('config', configSchema.parse(process.env));
  },
  { name: 'config' }
);
