import {
  loginRequestSchema,
  loginResponseSchema,
  sessionUserSchema,
  type LoginResponse,
  type SessionUser
} from '@hq-geap/contracts/auth';
import type { FastifyPluginAsync } from 'fastify';
import { createAuthRepository } from './repository.js';
import { authenticateUser, toSessionUser } from './service.js';

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
      token: app.jwt.sign(
        { sub: user.id },
        { expiresIn: app.config.JWT_EXPIRES_IN_SECONDS }
      ),
      user: toSessionUser(user)
    });
  });

  app.get('/auth/session', async (request): Promise<SessionUser> => {
    return sessionUserSchema.parse(request.authUser);
  });
};

export default authRoutes;
