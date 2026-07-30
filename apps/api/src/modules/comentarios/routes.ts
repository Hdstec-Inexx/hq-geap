import {
  atualizarStatusComentarioSchema,
  criarComentarioSchema,
  filtroStatusComentarioSchema,
  type Comentario,
  type ComentarioFila
} from '@hq-geap/contracts/comentarios';
import type { FastifyPluginAsync } from 'fastify';
import { createComentariosRepository } from './repository.js';
import { toComentario, toComentarioFila } from './service.js';

const routes: FastifyPluginAsync = async (app) => {
  const repository = createComentariosRepository(app.db);
  const readAuth = {
    config: {
      auth: { roles: ['curador' as const, 'gestao' as const] }
    }
  };
  const writeAuth = {
    config: { auth: { roles: ['curador' as const] } }
  };
  const adminAuth = {
    config: { auth: { roles: ['admin' as const] } }
  };

  app.get<{ Params: { atendimentoId: string } }>(
    '/atendimentos/:atendimentoId/comentarios',
    readAuth,
    async (request): Promise<Comentario[]> => {
      if (!(await repository.atendimentoExists(request.params.atendimentoId))) {
        throw app.httpErrors.notFound('Atendimento nao encontrado');
      }
      return (await repository.listByAtendimento(request.params.atendimentoId)).map(
        toComentario
      );
    }
  );

  app.post<{ Params: { atendimentoId: string } }>(
    '/atendimentos/:atendimentoId/comentarios',
    writeAuth,
    async (request, reply): Promise<Comentario> => {
      const parsed = criarComentarioSchema.safeParse(request.body);
      if (!parsed.success) throw app.httpErrors.badRequest('Comentario invalido');
      if (!(await repository.atendimentoExists(request.params.atendimentoId))) {
        throw app.httpErrors.notFound('Atendimento nao encontrado');
      }
      const created = await repository.create(
        request.params.atendimentoId,
        request.authUser!.id,
        parsed.data.texto
      );
      reply.code(201);
      return toComentario(created);
    }
  );

  app.get<{ Querystring: { status?: string } }>(
    '/comentarios',
    adminAuth,
    async (request): Promise<ComentarioFila[]> => {
      const parsed = filtroStatusComentarioSchema.safeParse(request.query);
      if (!parsed.success) throw app.httpErrors.badRequest('Status invalido');
      return (await repository.listByStatus(parsed.data.status)).map(toComentarioFila);
    }
  );

  app.patch<{ Params: { comentarioId: string } }>(
    '/comentarios/:comentarioId',
    adminAuth,
    async (request): Promise<Comentario> => {
      const parsed = atualizarStatusComentarioSchema.safeParse(request.body);
      if (!parsed.success) throw app.httpErrors.badRequest('Status invalido');
      const resolved = await repository.resolve(
        request.params.comentarioId,
        request.authUser!.id
      );
      if (resolved) return toComentario(resolved);
      if (!(await repository.findById(request.params.comentarioId))) {
        throw app.httpErrors.notFound('Comentario nao encontrado');
      }
      throw app.httpErrors.conflict('Comentario ja resolvido');
    }
  );
};

export default routes;
