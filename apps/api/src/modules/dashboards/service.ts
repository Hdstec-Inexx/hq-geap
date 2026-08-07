import {
  dashboardSchema,
  SLA_META_PERCENTUAL,
  type Dashboard,
  type DashboardPeriod
} from '@hq-geap/contracts/dashboards';
import type { DashboardRepository } from './repository.js';

function numberOrNull(value: string | null, decimals = 2) {
  if (value === null) return null;
  return Number(Number(value).toFixed(decimals));
}

function percentage(part: number, total: number) {
  return total === 0 ? null : Number(((part / total) * 100).toFixed(1));
}

export async function getDashboard(
  repository: DashboardRepository,
  periodo: DashboardPeriod
): Promise<Dashboard> {
  const kpis = await repository.getKpis(periodo);
  const motivos = await repository.listMotivos(periodo);
  const criterios = await repository.listCriterios(periodo);
  const concordancia = await repository.getConcordancia(periodo);
  const porCriterio = await repository.listConcordanciaPorCriterio(periodo);
  const piores = await repository.listPiores(periodo);

  const volume = Number(kpis.volume);
  const resolvidas = Number(kpis.resolvidas);
  const dentroSla = Number(kpis.dentroSla);
  const toolsTotal = Number(kpis.toolsTotal);
  const toolsSuccessful = Number(kpis.toolsSuccessful);
  const notasConcordantes = Number(concordancia.notasConcordantes);
  const totalNotas = Number(concordancia.totalNotas);
  const criteriosConcordantes = Number(concordancia.criteriosConcordantes);
  const totalCriterios = Number(concordancia.totalCriterios);

  return dashboardSchema.parse({
    periodo,
    kpis: {
      volume,
      tmaSegundos: numberOrNull(kpis.tmaSegundos, 0),
      tmeSegundos: numberOrNull(kpis.tmeSegundos, 0),
      taxaResolvidas: percentage(resolvidas, volume),
      sla: percentage(dentroSla, volume),
      slaMeta: SLA_META_PERCENTUAL,
      notaMediaIa: numberOrNull(kpis.notaMediaIa),
      notaMediaCurador: numberOrNull(kpis.notaMediaCurador),
      taxaPromessasCumpridas: percentage(toolsSuccessful, toolsTotal),
      tempoMedioAteResolucao: numberOrNull(kpis.tempoMedioAteResolucao, 0)
    },
    motivosContato: motivos.map((row) => ({
      motivo: row.motivo,
      total: Number(row.total)
    })),
    criterios: criterios.map((row) => {
      const atendidos = Number(row.atendidos);
      const avaliados = Number(row.avaliados);
      return {
        criterioId: row.criterioId,
        chave: row.chave,
        nome: row.nome,
        atendidos,
        avaliados,
        percentualAcerto: percentage(atendidos, avaliados)
      };
    }),
    concordancia: {
      nota: {
        concordantes: notasConcordantes,
        total: totalNotas,
        percentual: percentage(notasConcordantes, totalNotas)
      },
      criterios: {
        concordantes: criteriosConcordantes,
        total: totalCriterios,
        percentual: percentage(criteriosConcordantes, totalCriterios)
      },
      porCriterio: porCriterio.map((row) => {
        const concordantes = Number(row.concordantes);
        const total = Number(row.total);
        return {
          criterioId: row.criterioId,
          chave: row.chave,
          nome: row.nome,
          concordantes,
          total,
          percentual: percentage(concordantes, total)
        };
      })
    },
    pioresAtendimentos: piores.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      concluidoEm: row.concluidoEm.toISOString(),
      motivoContato: row.motivoContato,
      notaIa: Number(row.notaIa),
      notaCurador: numberOrNull(row.notaCurador)
    }))
  });
}
