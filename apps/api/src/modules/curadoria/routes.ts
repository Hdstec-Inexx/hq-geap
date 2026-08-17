import {
  filaCuradoriaQuerySchema,
  salvarConferenciaSchema,
  type AvaliacaoCurador,
  type CuradoriaDetail,
  type FilaCuradoriaPage
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
    config: {
      auth: { roles: ['curador' as const, 'gestao' as const, 'admin' as const] }
    }
  };
  const writeAuth = {
    config: { auth: { roles: ['curador' as const, 'admin' as const] } }
  };

  app.get('/curadoria', readAuth, async (request): Promise<FilaCuradoriaPage> => {
    const query = filaCuradoriaQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw app.httpErrors.badRequest('Invalid Fila de Curadoria query');
    }
    const page = await repository.listPending(query.data);
    return {
      items: page.items.map(toFilaCuradoriaItem),
      total: page.total
    };
  });

  app.get<{ Params: { atendimentoId: string } }>(
    '/curadoria/:atendimentoId',
    readAuth,
    async (request): Promise<CuradoriaDetail> => {
      const row = await repository.findDetail(request.params.atendimentoId);
      if (!row) throw app.httpErrors.notFound('Atendimento avaliado pela IA nao encontrado');
      let audioUrl: string | null = null;
      try {
        audioUrl = await app.storage.resolveAudioUrl(row.audioReference);
      } catch {
        request.log.warn(
          { atendimentoId: row.id },
          'Failed to resolve Atendimento audio URL'
        );
      }
      return toCuradoriaDetail(row, audioUrl);
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
      const created = await repository.createEvaluation({
        atendimentoId: request.params.atendimentoId,
        avaliacaoIaId: detail.avaliacaoIa.id,
        autorUsuarioId: request.authUser!.id,
        nota: conferencia.nota,
        falhasIdentificadas: parsed.data.falhasIdentificadas,
        resumoAtendimento: parsed.data.resumoAtendimento ?? null,
        notaAvaliacaoIa: parsed.data.notaAvaliacaoIa,
        comentario: parsed.data.comentario ?? null,
        checklist: conferencia.checklist
      });
      reply.code(201);
      return toAvaliacaoCurador(created);
    }
  );
};

export default routes;
