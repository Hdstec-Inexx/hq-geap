import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import config from './plugins/config.js';
import database from './plugins/database.js';
import auth from './plugins/auth.js';
import modules from './plugins/modules.js';
import storage from './plugins/storage.js';
import reprocessamentoTranscricao, {
  type ReprocessamentoPluginOptions
} from './plugins/reprocessamento-transcricao.js';

export interface BuildAppOptions {
  reprocessamento?: ReprocessamentoPluginOptions;
}

export async function buildApp(options?: BuildAppOptions) {
  const app = Fastify({ logger: true });

  await app.register(config);
  await app.register(cors, {
    origin: app.config.CORS_ORIGIN,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE']
  });
  await app.register(sensible);
  await app.register(database);
  await app.register(storage);
  await app.register(auth);
  await app.register(modules);
  await app.register(reprocessamentoTranscricao, options?.reprocessamento ?? {});

  return app;
}
