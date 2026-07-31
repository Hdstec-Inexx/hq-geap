import {
  dashboardPeriodSchema,
  type Dashboard
} from '@hq-geap/contracts/dashboards';
import type { FastifyPluginAsync } from 'fastify';
import { createDashboardRepository } from './repository.js';
import { getDashboard } from './service.js';

const routes: FastifyPluginAsync = async (app) => {
  const repository = createDashboardRepository(app.db);

  app.get<{ Querystring: { inicio?: string; fim?: string } }>(
    '/dashboards/gestao',
    { config: { auth: { roles: ['gestao', 'admin'] } } },
    async (request): Promise<Dashboard> => {
      const periodo = dashboardPeriodSchema.safeParse(request.query);
      if (!periodo.success) {
        throw app.httpErrors.badRequest(
          periodo.error.issues[0]?.message ?? 'Periodo invalido'
        );
      }
      return getDashboard(repository, periodo.data);
    }
  );
};

export default routes;
