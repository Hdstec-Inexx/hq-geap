import type { AvaliacaoIa } from '@hq-geap/contracts/avaliacoes';
import type { FastifyPluginAsync } from 'fastify';
import { createAvaliacoesRepository } from './repository.js';
import { toAvaliacaoIa } from './service.js';

const routes: FastifyPluginAsync = async (app) => {
  const repository = createAvaliacoesRepository(app.db);

  app.get<{ Params: { atendimentoId: string } }>(
    '/atendimentos/:atendimentoId/avaliacao-ia',
    async (request): Promise<AvaliacaoIa | null> => {
      const row = await repository.findIaByAtendimentoId(
        request.params.atendimentoId
      );
      return row ? toAvaliacaoIa(row) : null;
    }
  );
};

export default routes;
