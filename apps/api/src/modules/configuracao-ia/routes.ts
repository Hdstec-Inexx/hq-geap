import {
  publishConfiguracaoIaSchema,
  type ConfiguracaoIa
} from '@hq-geap/contracts/configuracao-ia';
import type { FastifyPluginAsync } from 'fastify';
import { createConfiguracaoIaRepository } from './repository.js';
import { toConfiguracaoIa } from './service.js';

const configuracaoIaRoutes: FastifyPluginAsync = async (app) => {
  const repository = createConfiguracaoIaRepository(app.db);
  const adminOnly = { config: { auth: { roles: ['admin' as const] } } };

  app.get(
    '/admin/configuracao-ia',
    adminOnly,
    async (): Promise<ConfiguracaoIa> => {
      const active = await repository.findActive();
      if (!active) {
        throw app.httpErrors.notFound('Active AI configuration not found');
      }
      return toConfiguracaoIa(active);
    }
  );

  app.post(
    '/admin/configuracao-ia',
    adminOnly,
    async (request, reply): Promise<ConfiguracaoIa> => {
      const configuration = publishConfiguracaoIaSchema.safeParse(request.body);
      if (!configuration.success) {
        throw app.httpErrors.badRequest('Invalid AI configuration');
      }

      const published = await repository.publish(
        configuration.data,
        request.authUser!.id
      );
      reply.code(201);
      return toConfiguracaoIa(published);
    }
  );
};

export default configuracaoIaRoutes;
