import {
  dashboardSchema,
  type Dashboard,
  type DashboardPeriod
} from '@hq-geap/contracts/dashboards';
import type { DashboardRepository } from './repository.js';

function numberOrNull(value: string | null, decimals = 2) {
  if (value === null) return null;
  return Number(Number(value).toFixed(decimals));
}

function percentage(concordantes: number, total: number) {
  return total === 0 ? null : Number(((concordantes / total) * 100).toFixed(1));
}

export async function getDashboard(
  repository: DashboardRepository,
  periodo: DashboardPeriod
): Promise<Dashboard> {
  const [kpis, motivos, criterios, concordancia, porCriterio, piores] =
    await Promise.all([
      repository.getKpis(periodo),
      repository.listMotivos(periodo),
      repository.listCriterios(periodo),
      repository.getConcordancia(periodo),
      repository.listConcordanciaPorCriterio(periodo),
      repository.listPiores(periodo)
    ]);

  const notasConcordantes = Number(concordancia.notasConcordantes);
  const totalNotas = Number(concordancia.totalNotas);
  const criteriosConcordantes = Number(concordancia.criteriosConcordantes);
  const totalCriterios = Number(concordancia.totalCriterios);

  return dashboardSchema.parse({
    periodo,
    kpis: {
      volume: Number(kpis.volume),
      tmaSegundos: numberOrNull(kpis.tmaSegundos, 0),
      notaMediaIa: numberOrNull(kpis.notaMediaIa),
      notaMediaCurador: numberOrNull(kpis.notaMediaCurador),
      transferencias: Number(kpis.transferencias),
      resolvidosSemTransferencia: Number(kpis.resolvidosSemTransferencia),
      custoTotal: numberOrNull(kpis.custoTotal, 4),
      custoMedio: numberOrNull(kpis.custoMedio, 4)
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
