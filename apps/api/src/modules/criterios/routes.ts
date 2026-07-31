import {
  reguaAvaliacaoSchema,
  type ReguaAvaliacao
} from '@hq-geap/contracts/criterios';
import type { FastifyPluginAsync } from 'fastify';
import { createCriteriosRepository } from './repository.js';

const criteriosRoutes: FastifyPluginAsync = async (app) => {
  const repository = createCriteriosRepository(app.db);

  app.get(
    '/admin/criterios',
    { config: { auth: { roles: ['admin'] } } },
    async (): Promise<ReguaAvaliacao> => {
      const criterios = await repository.findVigentes();
      return reguaAvaliacaoSchema.parse({
        vigente: true,
        total: 10,
        limiarAprovacao: 7,
        criterios: criterios.map((criterio) => ({
          ...criterio,
          valor: Number(criterio.valor)
        }))
      });
    }
  );
};

export default criteriosRoutes;
