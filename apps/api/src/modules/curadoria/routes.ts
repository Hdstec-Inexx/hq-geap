import {
  salvarConferenciaSchema,
  type AvaliacaoCurador,
  type CuradoriaDetail,
  type FilaCuradoriaItem
} from '@hq-geap/contracts/curadoria';
import type { FastifyPluginAsync } from 'fastify';
import { createCuradoriaRepository } from './repository.js';
import {
  calcularConferencia,
  toAvaliacaoCurador,
  toCuradoriaDetail,
  toFilaCuradoriaItem
} from './service.js';

const routes: FastifyPluginAsync = async (app) => {
  const repository = createCuradoriaRepository(app.db);
  const readAuth = {
    config: { auth: { roles: ['curador' as const, 'gestao' as const] } }
  };
  const writeAuth = { config: { auth: { roles: ['curador' as const] } } };

  app.get('/curadoria', readAuth, async (): Promise<FilaCuradoriaItem[]> =>
    (await repository.listPending()).map(toFilaCuradoriaItem)
  );

  app.get<{ Params: { atendimentoId: string } }>(
    '/curadoria/:atendimentoId',
    readAuth,
    async (request): Promise<CuradoriaDetail> => {
      const row = await repository.findDetail(request.params.atendimentoId);
      if (!row) throw app.httpErrors.notFound('Atendimento avaliado pela IA nao encontrado');
      return toCuradoriaDetail(
        row,
        await app.storage.resolveAudioUrl(row.audioReference)
      );
    }
  );

  app.post<{ Params: { atendimentoId: string } }>(
    '/curadoria/:atendimentoId/avaliacoes',
    writeAuth,
    async (request, reply): Promise<AvaliacaoCurador> => {
      const parsed = salvarConferenciaSchema.safeParse(request.body);
      if (!parsed.success) throw app.httpErrors.badRequest('Checklist invalido');
      const detail = await repository.findDetail(request.params.atendimentoId);
      if (!detail) throw app.httpErrors.notFound('Atendimento avaliado pela IA nao encontrado');
      if (detail.status !== 'concluido') {
        throw app.httpErrors.conflict('Atendimento em andamento nao pode ser avaliado');
      }

      let conferencia;
      try {
        conferencia = calcularConferencia(detail.avaliacaoIa.checklist, parsed.data.checklist);
      } catch (error) {
        throw app.httpErrors.unprocessableEntity(
          error instanceof Error ? error.message : 'Conferencia invalida'
        );
      }
      const created = await repository.createEvaluation(
        request.params.atendimentoId,
        request.authUser!.id,
        conferencia.nota,
        conferencia.checklist
      );
      reply.code(201);
      return toAvaliacaoCurador(created);
    }
  );
};

export default routes;
