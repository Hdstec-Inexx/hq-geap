import jwt from '@fastify/jwt';
import type { SessionUser, UserRole } from '@hq-geap/contracts/auth';
import fp from 'fastify-plugin';
import { createAuthRepository } from '../modules/auth/repository.js';
import {
  canAccessRoles,
  canUseMethod,
  redactCostFromJson
} from '../modules/auth/policy.js';
import { toSessionUser } from '../modules/auth/service.js';

type AuthRouteConfig = false | { roles?: UserRole[] };

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthRouteConfig;
  }

  interface FastifyRequest {
    authUser: SessionUser | null;
  }
}

export default fp(
  async (app) => {
    await app.register(jwt, { secret: app.config.JWT_SECRET });
    app.decorateRequest('authUser', null);
    const repository = createAuthRepository(app.db);

    app.addHook('onRequest', async (request) => {
      const authConfig = request.routeOptions.config.auth;
      if (authConfig === false || request.method === 'OPTIONS') {
        return;
      }

      let payload: { sub: string };
      try {
        payload = await request.jwtVerify<{ sub: string }>();
      } catch {
        throw app.httpErrors.unauthorized('Authentication required');
      }

      const user = await repository.findActiveById(payload.sub);
      if (!user) {
        throw app.httpErrors.unauthorized('Authentication required');
      }

      request.authUser = toSessionUser(user);

      if (!canUseMethod(user.role, request.method)) {
        throw app.httpErrors.forbidden('Gestao has read-only access');
      }

      if (!canAccessRoles(user.role, authConfig ? authConfig.roles : undefined)) {
        throw app.httpErrors.forbidden('Role does not have permission');
      }
    });

    app.addHook('onSend', async (request, reply, payload) => {
      const contentType = String(reply.getHeader('content-type') ?? '');
      if (
        request.authUser?.role === 'curador' &&
        contentType.includes('application/json')
      ) {
        if (typeof payload === 'string') {
          return redactCostFromJson(payload);
        }
        if (Buffer.isBuffer(payload)) {
          return Buffer.from(redactCostFromJson(payload.toString()));
        }
      }
      return payload;
    });
  },
  { name: 'auth', dependencies: ['config', 'database'] }
);
