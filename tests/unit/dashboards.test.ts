import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dashboardPeriodSchema } from '../../packages/contracts/src/dashboards.js';
import type { DashboardRepository } from '../../apps/api/src/modules/dashboards/repository.js';
import { getDashboard } from '../../apps/api/src/modules/dashboards/service.js';

test('rejeita periodos maiores que um ano', () => {
  const result = dashboardPeriodSchema.safeParse({
    inicio: '2025-01-01',
    fim: '2026-01-02'
  });

  assert.equal(result.success, false);
});

test('consulta as partes do dashboard sem ocupar varias conexoes simultaneamente', async () => {
  let activeQueries = 0;
  let maximumActiveQueries = 0;

  async function query<T>(result: T) {
    activeQueries += 1;
    maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeQueries -= 1;
    return result;
  }

  const repository = {
    getKpis: () =>
      query({
        volume: '0',
        tmaSegundos: null,
        notaMediaIa: null,
        notaMediaCurador: null,
        transferencias: '0',
        resolvidosSemTransferencia: '0',
        custoTotal: null,
        custoMedio: null
      }),
    listMotivos: () => query([]),
    listCriterios: () => query([]),
    getConcordancia: () =>
      query({
        notasConcordantes: '0',
        totalNotas: '0',
        criteriosConcordantes: '0',
        totalCriterios: '0'
      }),
    listConcordanciaPorCriterio: () => query([]),
    listPiores: () => query([])
  } as unknown as DashboardRepository;

  await getDashboard(repository, { inicio: '2025-01-01', fim: '2025-01-31' });

  assert.equal(maximumActiveQueries, 1);
});
