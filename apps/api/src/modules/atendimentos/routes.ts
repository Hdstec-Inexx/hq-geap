import {
  ingestAtendimentoSchema,
  atendimentosQuerySchema,
  type AtendimentoDetail,
  type AtendimentoSummary
} from '@hq-geap/contracts/atendimentos';
import type { FastifyPluginAsync } from 'fastify';
import { isDetalhamentoQuery } from './detalhamentoFilters.js';
import {
  AtendimentoAgentMismatchError,
  createAtendimentosRepository,
  InvalidAtendimentoTransitionError,
  UnknownVoiceAgentError
} from './repository.js';
import { toAtendimentoDetail, toAtendimentoSummary } from './service.js';

const routes: FastifyPluginAsync = async (app) => {
  const repository = createAtendimentosRepository(app.db);

  app.post(
    '/atendimentos/ingestao',
    { config: { auth: false } },
    async (request, reply): Promise<AtendimentoDetail> => {
      if (request.headers['x-ingestion-key'] !== app.config.INGESTION_API_KEY) {
        throw app.httpErrors.unauthorized('Invalid ingestion credential');
      }
      const parsed = ingestAtendimentoSchema.safeParse(request.body);
      if (!parsed.success) {
        throw app.httpErrors.badRequest('Invalid Atendimento payload');
      }

      try {
        const result = await repository.ingest(parsed.data);
        reply.code(result.created ? 201 : 200);
        let audioUrl: string | null = null;
        try {
          audioUrl = await app.storage.resolveAudioUrl(result.row.audioReference);
        } catch {
          request.log.warn(
            { conversationId: result.row.conversationId },
            'Failed to resolve Atendimento audio URL'
          );
        }
        return toAtendimentoDetail(result.row, audioUrl);
      } catch (error) {
        if (error instanceof UnknownVoiceAgentError) {
          throw app.httpErrors.unprocessableEntity('Unknown voice agent');
        }
        if (
          error instanceof InvalidAtendimentoTransitionError ||
          error instanceof AtendimentoAgentMismatchError
        ) {
          throw app.httpErrors.conflict('Invalid Atendimento update');
        }
        throw error;
      }
    }
  );

  app.get('/atendimentos', async (request): Promise<AtendimentoSummary[]> => {
    const query = atendimentosQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw app.httpErrors.badRequest('Invalid Atendimentos query');
    }
    if (isDetalhamentoQuery(query.data)) {
      const role = request.authUser?.role;
      if (role !== 'admin' && role !== 'gestao') {
        throw app.httpErrors.forbidden('Role does not have permission');
      }
    }
    return (await repository.list(query.data)).map(toAtendimentoSummary);
  });

  app.get<{ Params: { id: string } }>(
    '/atendimentos/:id',
    async (request): Promise<AtendimentoDetail> => {
      const row = await repository.findById(request.params.id);
      if (!row) {
        throw app.httpErrors.notFound('Atendimento not found');
      }
      let audioUrl: string | null = null;
      try {
        audioUrl = await app.storage.resolveAudioUrl(row.audioReference);
      } catch {
        request.log.warn(
          { atendimentoId: row.id },
          'Failed to resolve Atendimento audio URL'
        );
      }
      return toAtendimentoDetail(row, audioUrl);
    }
  );
};

export default routes;
