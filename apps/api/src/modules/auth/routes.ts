import {
  loginRequestSchema,
  loginResponseSchema,
  perfilSchema,
  sessionIdentitySchema,
  type LoginResponse,
  type Perfil,
  type SessionIdentity
} from '@hq-geap/contracts/auth';
import type { FastifyPluginAsync } from 'fastify';
import { createAuthRepository } from './repository.js';
import {
  authenticateUser,
  toSessionIdentity,
  toSessionTokenClaims
} from './service.js';

const authRoutes: FastifyPluginAsync = async (app) => {
  const repository = createAuthRepository(app.db);

  app.post('/auth/login', { config: { auth: false } }, async (request): Promise<LoginResponse> => {
    const credentials = loginRequestSchema.safeParse(request.body);
    if (!credentials.success) {
      throw app.httpErrors.badRequest('Email and password are required');
    }

    const user = await authenticateUser(repository, credentials.data);
    if (!user) {
      throw app.httpErrors.unauthorized('Invalid email or password');
    }

    return loginResponseSchema.parse({
      token: app.jwt.sign(toSessionTokenClaims(user), {
        expiresIn: app.config.JWT_EXPIRES_IN_SECONDS
      }),
      user: toSessionIdentity(user)
    });
  });

  app.get('/auth/session', async (request): Promise<SessionIdentity> => {
    return sessionIdentitySchema.parse({ id: request.authUser!.id });
  });

  app.get('/me', async (request): Promise<Perfil> => {
    return perfilSchema.parse(request.authUser);
  });
};

export default authRoutes;
