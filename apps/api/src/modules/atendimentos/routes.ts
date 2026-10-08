import {
  ingestAtendimentoSchema,
  atendimentosQuerySchema,
  type AtendimentoDetail,
  type AtendimentoList,
  type FavoritosInfo,
  type MutacaoFavoritoResponse
} from '@hq-geap/contracts/atendimentos';
import {
  favoritosCuradorSchema,
  favoritosGestaoSchema,
  favoritosQuerySchema,
  type FavoritosCurador,
  type FavoritosGestao
} from '@hq-geap/contracts/favoritos';
import type { FastifyPluginAsync } from 'fastify';
import { isDetalhamentoQuery } from './detalhamentoFilters.js';
import {
  AtendimentoAgentMismatchError,
  createAtendimentosRepository,
  InvalidAtendimentoTransitionError,
  UnknownVoiceAgentError
} from './repository.js';
import { toAtendimentoDetail, toAtendimentoSummary } from './service.js';

export function isCuradorRole(authUser: { role: string } | null | undefined): boolean {
  return authUser?.role === 'curador';
}

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

  app.get('/atendimentos', async (request): Promise<AtendimentoList> => {
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
    const user = request.authUser;
    const list = await repository.list(query.data, user?.role === 'curador' ? user.id : null);
    return {
      items: list.items.map((row) => toAtendimentoSummary(row, { role: user?.role })),
      total: list.total
    };
  });

  app.get('/favoritos', async (request): Promise<FavoritosCurador | FavoritosGestao> => {
    const parsed = favoritosQuerySchema.safeParse(request.query);
    if (!parsed.success) throw app.httpErrors.badRequest('Invalid Favoritos query');
    const user = request.authUser;
    if (!user) throw app.httpErrors.unauthorized('Authentication required');
    if (user.role !== 'curador' && user.role !== 'gestao' && user.role !== 'admin') {
      throw app.httpErrors.forbidden('Role does not have permission');
    }
    const query = user.role === 'curador'
      ? { ...parsed.data, perfilId: undefined }
      : parsed.data;
    const result = await repository.listFavoritos(query, user.role === 'curador' ? user.id : null);
    if (user.role === 'curador') {
      return favoritosCuradorSchema.parse({
        total: result.total,
        items: result.items.map((row) => ({ ...toAtendimentoSummary(row), favoritadoEm: new Date((row as typeof row & { favoritadoEm: Date }).favoritadoEm).toISOString() }))
      });
    }
    return favoritosGestaoSchema.parse({
      total: result.total,
      items: result.items.map((row) => {
        const timestamp = new Date((row as typeof row & { ultimoFavoritadoEm: Date }).ultimoFavoritadoEm).toISOString();
        return {
          ...toAtendimentoSummary(row),
          ultimoFavoritadoEm: timestamp,
          favoritadoEm: timestamp,
          favoritos: (row as typeof row & { favoritos: FavoritosGestao['items'][number]['favoritos'] }).favoritos
        };
      })
    });
  });

  app.get('/atendimentos/motivos', async (): Promise<string[]> => {
    return repository.listDistinctMotivos();
  });

  app.get('/agentes-voz', async () => {
    const result = await app.db.query<{ id: string; nome: string }>(
      'select id, nome from agentes_voz order by nome'
    );
    return result.rows;
  });

  app.get<{ Params: { conversationId: string } }>(
    '/atendimentos/by-conversation/:conversationId',
    async (request): Promise<AtendimentoDetail> => {
      const row = await repository.findByConversationId(request.params.conversationId);
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

      const user = request.authUser;
      const options = user?.role === 'curador'
        ? { favoritadoPeloUsuario: await repository.isFavoritadoByPerfil(row.id, user.id) }
        : user?.role === 'gestao' || user?.role === 'admin'
          ? { favoritos: await repository.findFavoritos(row.id) }
          : undefined;
      return toAtendimentoDetail(row, audioUrl, options);
    }
  );

  const curadorOnly = {
    config: {
      auth: {
        roles: ['curador' as const]
      }
    },
    preHandler: async (request: { authUser: { role: string } | null }) => {
      if (!isCuradorRole(request.authUser)) {
        throw app.httpErrors.forbidden('Role does not have permission');
      }
    }
  };

  app.post<{ Params: { id: string } }>(
    '/atendimentos/:id/favorito',
    curadorOnly,
    async (request): Promise<MutacaoFavoritoResponse> => {
      const row = await repository.findById(request.params.id);
      if (!row) {
        throw app.httpErrors.notFound('Atendimento not found');
      }
      const perfil = request.authUser;
      if (!perfil) {
        throw app.httpErrors.unauthorized('Authentication required');
      }
      await repository.addFavorito(row.id, perfil.id);
      return { favoritadoPeloUsuario: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/atendimentos/:id/favorito',
    curadorOnly,
    async (request): Promise<MutacaoFavoritoResponse> => {
      const row = await repository.findById(request.params.id);
      if (!row) {
        throw app.httpErrors.notFound('Atendimento not found');
      }
      const perfil = request.authUser;
      if (!perfil) {
        throw app.httpErrors.unauthorized('Authentication required');
      }
      await repository.removeFavorito(row.id, perfil.id);
      return { favoritadoPeloUsuario: false };
    }
  );

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

      let favoritadoPeloUsuario: boolean | undefined;
      let favoritos: FavoritosInfo | undefined;

      const user = request.authUser;
      if (user?.role === 'curador') {
        favoritadoPeloUsuario = await repository.isFavoritadoByPerfil(row.id, user.id);
      } else if (user?.role === 'gestao' || user?.role === 'admin') {
        favoritos = await repository.findFavoritos(row.id);
      }

      return toAtendimentoDetail(row, audioUrl, {
        favoritadoPeloUsuario,
        favoritos
      });
    }
  );
};

export default routes;
