import {
  reguaAvaliacaoSchema,
  type ReguaAvaliacao
} from '@hq-geap/contracts/criterios';
import type { FastifyPluginAsync } from 'fastify';
import { createCriteriosRepository } from './repository.js';

const criteriosRoutes: FastifyPluginAsync = async (app) => {
  const repository = createCriteriosRepository(app.db);

  const getCriteriosHandler = async (): Promise<ReguaAvaliacao> => {
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
  };

  const authOptions = { config: { auth: { roles: ['admin' as const, 'gestao' as const, 'curador' as const] } } };

  app.get('/admin/criterios', authOptions, getCriteriosHandler);
  app.get('/criterios', authOptions, getCriteriosHandler);
};

export default criteriosRoutes;
