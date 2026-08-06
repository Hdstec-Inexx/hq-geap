import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  dashboardKpisSchema,
  dashboardPeriodSchema,
  SLA_META_PERCENTUAL,
  SLA_TME_LIMITE_SEGUNDOS
} from '../../packages/contracts/src/dashboards.js';
import type { DashboardRepository } from '../../apps/api/src/modules/dashboards/repository.js';
import { getDashboard } from '../../apps/api/src/modules/dashboards/service.js';

test('rejeita periodos maiores que um ano', () => {
  const result = dashboardPeriodSchema.safeParse({
    inicio: '2025-01-01',
    fim: '2026-01-02'
  });

  assert.equal(result.success, false);
});

test('contrato de KPIs expoe o strip operacional acordado', () => {
  assert.equal(SLA_TME_LIMITE_SEGUNDOS, 150);
  assert.equal(SLA_META_PERCENTUAL, 80);

  const parsed = dashboardKpisSchema.parse({
    volume: 10,
    tmaSegundos: 90,
    tmeSegundos: 45,
    taxaResolvidas: 70,
    sla: 80,
    slaMeta: 80,
    notaMediaIa: 7.5,
    notaMediaCurador: 7,
    taxaPromessasCumpridas: 100,
    tempoMedioAteResolucao: 60
  });

  assert.deepEqual(Object.keys(parsed).sort(), [
    'notaMediaCurador',
    'notaMediaIa',
    'sla',
    'slaMeta',
    'taxaPromessasCumpridas',
    'taxaResolvidas',
    'tempoMedioAteResolucao',
    'tmaSegundos',
    'tmeSegundos',
    'volume'
  ]);
  assert.equal('transferencias' in parsed, false);
  assert.equal('custoTotal' in parsed, false);
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
        volume: '2',
        tmaSegundos: '90',
        tmeSegundos: '40',
        resolvidas: '1',
        dentroSla: '1',
        comTme: '2',
        notaMediaIa: '7',
        notaMediaCurador: '6.5',
        toolsTotal: '3',
        toolsSuccessful: '2',
        tempoMedioAteResolucao: '60'
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

  const dashboard = await getDashboard(repository, {
    inicio: '2025-01-01',
    fim: '2025-01-31'
  });

  assert.equal(maximumActiveQueries, 1);
  assert.deepEqual(dashboard.kpis, {
    volume: 2,
    tmaSegundos: 90,
    tmeSegundos: 40,
    taxaResolvidas: 50,
    sla: 50,
    slaMeta: 80,
    notaMediaIa: 7,
    notaMediaCurador: 6.5,
    taxaPromessasCumpridas: 66.7,
    tempoMedioAteResolucao: 60
  });
});

test('KPIs nulos quando nao ha amostra para media ou taxa', async () => {
  const repository = {
    getKpis: async () => ({
      volume: '0',
      tmaSegundos: null,
      tmeSegundos: null,
      resolvidas: '0',
      dentroSla: '0',
      comTme: '0',
      notaMediaIa: null,
      notaMediaCurador: null,
      toolsTotal: '0',
      toolsSuccessful: '0',
      tempoMedioAteResolucao: null
    }),
    listMotivos: async () => [],
    listCriterios: async () => [],
    getConcordancia: async () => ({
      notasConcordantes: '0',
      totalNotas: '0',
      criteriosConcordantes: '0',
      totalCriterios: '0'
    }),
    listConcordanciaPorCriterio: async () => [],
    listPiores: async () => []
  } as unknown as DashboardRepository;

  const dashboard = await getDashboard(repository, {
    inicio: '2025-01-01',
    fim: '2025-01-31'
  });

  assert.deepEqual(dashboard.kpis, {
    volume: 0,
    tmaSegundos: null,
    tmeSegundos: null,
    taxaResolvidas: null,
    sla: null,
    slaMeta: 80,
    notaMediaIa: null,
    notaMediaCurador: null,
    taxaPromessasCumpridas: null,
    tempoMedioAteResolucao: null
  });
});
