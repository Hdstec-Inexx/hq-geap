import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  dashboardKpisSchema,
  dashboardPeriodSchema,
  dashboardSchema,
  SLA_META_PERCENTUAL,
  SLA_TME_LIMITE_SEGUNDOS
} from '../../packages/contracts/src/dashboards.js';
import { atendimentosQuerySchema } from '../../packages/contracts/src/atendimentos.js';
import type { DashboardRepository } from '../../apps/api/src/modules/dashboards/repository.js';
import { getDashboard } from '../../apps/api/src/modules/dashboards/service.js';
import { buildDetalhamentoFilters } from '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js';
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
    listCriteriosNaoConformidade: () => query([]),
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
    listCriteriosNaoConformidade: async () => [],
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
    listCriteriosNaoConformidade: async () => [],
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

  const naoConformidadeUrl = detalhamentoListPath({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    indicador: 'criterio_nao_atendido',
    criterioId: '11111111-1111-4111-a111-111111111111'
  });
  assert.equal(
    naoConformidadeUrl,
    '/atendimentos?inicio=2025-01-01&fim=2025-01-31&indicador=criterio_nao_atendido&criterioId=11111111-1111-4111-a111-111111111111'
  );
});

test('filtros SQL do Detalhamento suportam criterio_nao_atendido', () => {
  const filter = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'criterio_nao_atendido',
      criterioId: '11111111-1111-4111-a111-111111111111'
    })
  );

  assert.match(
    filter.clauses.join(' '),
    /ac\.criterio_id = \$3::uuid\s+and ac\.estado = 'nao_atendido'/
  );
  assert.equal(filter.values[2], '11111111-1111-4111-a111-111111111111');
});

test('getDashboard mapeia criteriosNaoConformidade ordenados', async () => {
  const repository = {
    getKpis: async () => ({
      volume: '3',
      tmaSegundos: null,
      resolvidas: '0',
      dentroSla: '0',
      notaMediaIa: null,
      notaMediaCurador: null,
      avaliadosIa: '3',
      avaliadosCurador: '0',
      toolsTotal: '0',
      toolsSuccessful: '0',
      tempoMedioAteResolucao: null
    }),
    listMotivos: async () => [
      { motivo: 'Financeiro / Boletos', total: '2' },
      { motivo: 'Não informado', total: '1' }
    ],
    listCriterios: async () => [],
    getConcordancia: async () => ({
      notasConcordantes: '0',
      totalNotas: '0',
      criteriosConcordantes: '0',
      totalCriterios: '0'
    }),
    listConcordanciaPorCriterio: async () => [],
    listCriteriosNaoConformidade: async () => [
      {
        criterioId: '11111111-1111-4111-a111-111111111111',
        chave: 'informou_protocolo_email',
        nome: 'Informação de Protocolo',
        total: '5'
      },
      {
        criterioId: '22222222-2222-4222-a222-222222222222',
        chave: 'saudacao_e_intencao',
        nome: 'Saudação e Intenção',
        total: '2'
      }
    ],
    listPiores: async () => []
  } as unknown as DashboardRepository;

  const dashboard = await getDashboard(repository, {
    inicio: '2025-01-01',
    fim: '2025-01-31'
  });

  assert.deepEqual(dashboard.motivosContato, [
    { motivo: 'Financeiro / Boletos', total: 2 },
    { motivo: 'Não informado', total: 1 }
  ]);
  assert.deepEqual(dashboard.criteriosNaoConformidade, [
    {
      criterioId: '11111111-1111-4111-a111-111111111111',
      chave: 'informou_protocolo_email',
      nome: 'Informação de Protocolo',
      total: 5
    },
    {
      criterioId: '22222222-2222-4222-a222-222222222222',
      chave: 'saudacao_e_intencao',
      nome: 'Saudação e Intenção',
      total: 2
    }
  ]);
});

test('dashboardSchema valida e expoe criteriosNaoConformidade', () => {
  const parsed = dashboardSchema.parse({
    periodo: { inicio: '2025-01-01', fim: '2025-01-31' },
    kpis: {
      volume: 1,
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
    },
    motivosContato: [{ motivo: 'Financeiro / Boletos', total: 1 }],
    criterios: [],
    concordancia: {
      nota: { concordantes: 0, total: 0, percentual: null },
      criterios: { concordantes: 0, total: 0, percentual: null },
      porCriterio: []
    },
    criteriosNaoConformidade: [
      {
        criterioId: '11111111-1111-4111-a111-111111111111',
        chave: 'informou_protocolo_email',
        nome: 'Informação de Protocolo',
        total: 3
      }
    ],
    pioresAtendimentos: []
  });

  assert.equal(parsed.criteriosNaoConformidade.length, 1);
  assert.equal(parsed.criteriosNaoConformidade[0]?.nome, 'Informação de Protocolo');
  assert.equal(parsed.criteriosNaoConformidade[0]?.total, 3);
});

test('styles.css mantem comparacoes de KPIs duplos lado a lado e legenda de motivos sem sobreposicao', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const css = await fs.readFile(
    path.resolve(process.cwd(), 'apps/web/src/styles.css'),
    'utf8'
  );

  // Valida que o KPI dual exibe os valores lado a lado (flex, nowrap)
  assert.match(
    css,
    /\.dashboard-kpi-dual strong\s*\{[^}]*display:\s*flex/i,
    'dashboard-kpi-dual strong deve usar display flex para manter valores lado a lado'
  );
  assert.match(
    css,
    /\.dashboard-kpi-dual strong\s*\{[^}]*white-space:\s*nowrap/i,
    'dashboard-kpi-dual strong deve ter white-space nowrap'
  );

  // Valida que a legenda de motivos previne quebra e sobreposição sobre as quantidades
  assert.match(
    css,
    /\.motivos-legend a\s*\{[^}]*min-width:\s*0/i,
    'links da legenda de motivos devem ter min-width: 0 para evitar blowout no grid'
  );
  assert.match(
    css,
    /\.motivos-legend a\s*\{[^}]*overflow-wrap:\s*break-word/i,
    'links da legenda devem quebrar texto longo sem vazar no grid'
  );
  assert.match(
    css,
    /\.motivos-legend li strong\s*\{[^}]*white-space:\s*nowrap/i,
    'quantidade na legenda deve ter white-space nowrap'
  );
  assert.match(
    css,
    /\.motivos-legend\s*\{[^}]*scrollbar-width:\s*thin/i,
    'legenda de motivos deve usar scrollbar fina'
  );

  // Valida que o painel de critérios ocupa 2 linhas no grid ao lado de Motivos e Concordância
  assert.match(
    css,
    /\.criterios-panel\s*\{[^}]*grid-row:\s*span\s+2/i,
    'criterios-panel deve ocupar 2 linhas no grid ao lado de Motivos e Concordância'
  );
});

test('listMotivos agrupa com Não informado canônico e acentuado', async () => {
  const { createDashboardRepository } = await import(
    '../../apps/api/src/modules/dashboards/repository.js'
  );

  let executedSql = '';
  const mockDb = {
    async query(sql: string) {
      executedSql = sql;
      return {
        rows: [
          { motivo: 'Financeiro/Boletos', total: '3' },
          { motivo: 'Não informado', total: '1' }
        ]
      };
    }
  } as any;

  const repo = createDashboardRepository(mockDb);
  const motivos = await repo.listMotivos({
    inicio: '2025-01-01',
    fim: '2025-01-31'
  });

  assert.deepEqual(motivos, [
    { motivo: 'Financeiro/Boletos', total: '3' },
    { motivo: 'Não informado', total: '1' }
  ]);
  assert.match(
    executedSql,
    /select coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) as motivo/i
  );
  assert.match(
    executedSql,
    /group by coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\)/i
  );
});
