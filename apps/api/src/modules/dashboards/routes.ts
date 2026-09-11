import {
  dashboardPeriodSchema,
  type Dashboard,
  type DashboardPeriod
} from '@hq-geap/contracts/dashboards';
import type { FastifyPluginAsync } from 'fastify';
import { countElevenLabsConversations } from './elevenLabsVolume.js';
import { createDashboardRepository } from './repository.js';
import { getDashboard } from './service.js';

const routes: FastifyPluginAsync = async (app) => {
  const repository = createDashboardRepository(app.db);

  async function countElevenLabsVolume(
    periodo: DashboardPeriod
  ): Promise<number | null> {
    const apiKey = app.config.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }
    try {
      const agentIds = await repository.listElevenLabsAgentIds();
      return await countElevenLabsConversations({
        apiBaseUrl: app.config.ELEVENLABS_API_URL,
        apiKey,
        agentIds,
        periodo
      });
    } catch (error) {
      app.log.warn(
        { err: error },
        'Falha ao contar Atendimentos na ElevenLabs para o Pulso'
      );
      return null;
    }
  }

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
      return getDashboard(repository, periodo.data, countElevenLabsVolume);
    }
  );
};

export default routes;
