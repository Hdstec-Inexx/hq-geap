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
import { detalhamentoListPath } from '../../apps/web/src/features/dashboards/detalhamento.js';

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
    taxaResolvidas: 70,
    sla: 80,
    slaMeta: 80,
    notaMediaIa: 7.5,
    notaMediaCurador: 7,
    avaliadosIa: 10,
    avaliadosCurador: 4,
    taxaPromessasCumpridas: 100,
    tempoMedioAteResolucao: 60
  });

  assert.deepEqual(Object.keys(parsed).sort(), [
    'avaliadosCurador',
    'avaliadosIa',
    'notaMediaCurador',
    'notaMediaIa',
    'sla',
    'slaMeta',
    'taxaPromessasCumpridas',
    'taxaResolvidas',
    'tempoMedioAteResolucao',
    'tmaSegundos',
    'volume'
  ]);
  assert.equal('tmeSegundos' in parsed, false);
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
        resolvidas: '1',
        dentroSla: '1',
        notaMediaIa: '7',
        notaMediaCurador: '6.5',
        avaliadosIa: '2',
        avaliadosCurador: '1',
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
    taxaResolvidas: 50,
    sla: 50,
    slaMeta: 80,
    notaMediaIa: 7,
    notaMediaCurador: 6.5,
    avaliadosIa: 2,
    avaliadosCurador: 1,
    taxaPromessasCumpridas: 66.7,
    tempoMedioAteResolucao: 60
  });
});

test('KPIs nulos quando nao ha amostra para media ou taxa', async () => {
  const repository = {
    getKpis: async () => ({
      volume: '0',
      tmaSegundos: null,
      resolvidas: '0',
      dentroSla: '0',
      notaMediaIa: null,
      notaMediaCurador: null,
      avaliadosIa: '0',
      avaliadosCurador: '0',
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
    taxaResolvidas: null,
    sla: null,
    slaMeta: 80,
    notaMediaIa: null,
    notaMediaCurador: null,
    avaliadosIa: 0,
    avaliadosCurador: 0,
    taxaPromessasCumpridas: null,
    tempoMedioAteResolucao: null
  });
});

test('SLA usa volume do periodo como denominador (volume 2, dentroSla 1 → 50%)', async () => {
  const repository = {
    getKpis: async () => ({
      volume: '2',
      tmaSegundos: '90',
      resolvidas: '1',
      dentroSla: '1',
      notaMediaIa: '7',
      notaMediaCurador: '6.5',
      avaliadosIa: '2',
      avaliadosCurador: '1',
      toolsTotal: '3',
      toolsSuccessful: '2',
      tempoMedioAteResolucao: '60'
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

  // SLA divides by volume so a missing Tempo de Espera still counts against
  // the rate (50%, not 100%).
  assert.equal(dashboard.kpis.volume, 2);
  assert.equal('tmeSegundos' in dashboard.kpis, false);
  assert.equal(dashboard.kpis.sla, 50);
  assert.equal(dashboard.kpis.slaMeta, 80);
});

test('detalhamentoListPath monta URLs para avaliados_ia e avaliados_curador', () => {
  const iaUrl = detalhamentoListPath({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    indicador: 'avaliados_ia'
  });
  assert.equal(
    iaUrl,
    '/atendimentos?inicio=2025-01-01&fim=2025-01-31&indicador=avaliados_ia'
  );

  const curadorUrl = detalhamentoListPath({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    indicador: 'avaliados_curador'
  });
  assert.equal(
    curadorUrl,
    '/atendimentos?inicio=2025-01-01&fim=2025-01-31&indicador=avaliados_curador'
  );
});
