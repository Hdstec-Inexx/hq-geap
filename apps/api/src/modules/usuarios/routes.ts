import {
  createUsuarioSchema,
  updateUsuarioSchema,
  type Usuario
} from '@hq-geap/contracts/usuarios';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createUsuariosRepository,
  LastActiveAdminError
} from './repository.js';
import {
  createUsuario,
  isDuplicateEmail,
  toUsuario
} from './service.js';

const paramsSchema = z.object({ id: z.uuid() });

const usuariosRoutes: FastifyPluginAsync = async (app) => {
  const repository = createUsuariosRepository(app.db);
  const adminOnly = { config: { auth: { roles: ['admin' as const] } } };

  app.get('/admin/usuarios', adminOnly, async (): Promise<Usuario[]> => {
    return (await repository.list()).map(toUsuario);
  });

  app.post(
    '/admin/usuarios',
    adminOnly,
    async (request, reply): Promise<Usuario> => {
      const input = createUsuarioSchema.safeParse(request.body);
      if (!input.success) {
        throw app.httpErrors.badRequest('Invalid user');
      }

      try {
        const created = await createUsuario(repository, input.data);
        reply.code(201);
        return toUsuario(created);
      } catch (error) {
        if (isDuplicateEmail(error)) {
          throw app.httpErrors.conflict('Email already in use');
        }
        throw error;
      }
    }
  );

  app.patch(
    '/admin/usuarios/:id',
    adminOnly,
    async (request): Promise<Usuario> => {
      const params = paramsSchema.safeParse(request.params);
      const input = updateUsuarioSchema.safeParse(request.body);
      if (!params.success || !input.success) {
        throw app.httpErrors.badRequest('Invalid user');
      }
      if (
        params.data.id === request.authUser!.id &&
        input.data.role !== 'admin'
      ) {
        throw app.httpErrors.conflict('Admin cannot remove their own access');
      }

      try {
        const updated = await repository.update(params.data.id, input.data);
        if (!updated) {
          throw app.httpErrors.notFound('User not found');
        }
        return toUsuario(updated);
      } catch (error) {
        if (isDuplicateEmail(error)) {
          throw app.httpErrors.conflict('Email already in use');
        }
        if (error instanceof LastActiveAdminError) {
          throw app.httpErrors.conflict('At least one active Admin is required');
        }
        throw error;
      }
    }
  );

  app.post(
    '/admin/usuarios/:id/desativar',
    adminOnly,
    async (request): Promise<Usuario> => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        throw app.httpErrors.badRequest('Invalid user id');
      }
      if (params.data.id === request.authUser!.id) {
        throw app.httpErrors.conflict('Admin cannot remove their own access');
      }
      let deactivated;
      try {
        deactivated = await repository.deactivate(params.data.id);
      } catch (error) {
        if (error instanceof LastActiveAdminError) {
          throw app.httpErrors.conflict('At least one active Admin is required');
        }
        throw error;
      }
      if (!deactivated) {
        throw app.httpErrors.notFound('User not found');
      }
      return toUsuario(deactivated);
    }
  );
};

export default usuariosRoutes;
