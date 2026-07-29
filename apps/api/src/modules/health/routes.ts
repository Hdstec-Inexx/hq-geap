import { healthResponseSchema, type HealthResponse } from '@hq-geap/contracts/health';
import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    { config: { auth: false } },
    async (): Promise<HealthResponse> => {
      await app.db.query('select 1');
      return healthResponseSchema.parse({ status: 'ok', database: 'ok' });
    }
  );
};

export default healthRoutes;
