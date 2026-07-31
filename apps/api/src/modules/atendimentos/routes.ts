import {
  ingestAtendimentoSchema,
  atendimentosQuerySchema,
  type AtendimentoDetail,
  type AtendimentoSummary
} from '@hq-geap/contracts/atendimentos';
import type { FastifyPluginAsync } from 'fastify';
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
        return toAtendimentoDetail(
          result.row,
          await app.storage.resolveAudioUrl(result.row.audioReference)
        );
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
      throw app.httpErrors.badRequest('Invalid pagination');
    }
    return (
      await repository.list(
        query.data.limit,
        query.data.offset,
        query.data.status
      )
    ).map(toAtendimentoSummary);
  });

  app.get<{ Params: { id: string } }>(
    '/atendimentos/:id',
    async (request): Promise<AtendimentoDetail> => {
      const row = await repository.findById(request.params.id);
      if (!row) {
        throw app.httpErrors.notFound('Atendimento not found');
      }
      return toAtendimentoDetail(
        row,
        await app.storage.resolveAudioUrl(row.audioReference)
      );
    }
  );
};

export default routes;
