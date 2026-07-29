import {
  ingestAtendimentoSchema,
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
          app.storage.resolveAudioUrl(result.row.audioUrl)
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

  app.get('/atendimentos', async (): Promise<AtendimentoSummary[]> => {
    return (await repository.list()).map(toAtendimentoSummary);
  });

  app.get<{ Params: { id: string } }>(
    '/atendimentos/:id',
    async (request): Promise<AtendimentoDetail> => {
      const row = await repository.findById(request.params.id);
      if (!row) {
        throw app.httpErrors.notFound('Atendimento not found');
      }
      return toAtendimentoDetail(row, app.storage.resolveAudioUrl(row.audioUrl));
    }
  );
};

export default routes;
