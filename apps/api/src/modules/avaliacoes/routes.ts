import type {
  AvaliacaoCuradorResumo,
  AvaliacaoIa
} from '@hq-geap/contracts/avaliacoes';
import type { FastifyPluginAsync } from 'fastify';
import { createAvaliacoesRepository } from './repository.js';
import { toAvaliacaoCuradorResumo, toAvaliacaoIa } from './service.js';

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

  app.get<{ Params: { atendimentoId: string } }>(
    '/atendimentos/:atendimentoId/avaliacao-curador',
    async (request): Promise<AvaliacaoCuradorResumo | null> => {
      const row = await repository.findLatestCuradorByAtendimentoId(
        request.params.atendimentoId
      );
      return row ? toAvaliacaoCuradorResumo(row) : null;
    }
  );
};

export default routes;
