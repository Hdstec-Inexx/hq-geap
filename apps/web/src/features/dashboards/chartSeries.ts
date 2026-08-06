import type { Dashboard } from '@hq-geap/contracts/dashboards';

export type ChartSeries = {
  labels: string[];
  values: Array<number | null>;
};

export function motivosChartSeries(
  motivos: Dashboard['motivosContato']
): ChartSeries {
  return {
    labels: motivos.map((item) => item.motivo),
    values: motivos.map((item) => item.total)
  };
}

export function criteriosChartSeries(
  criterios: Dashboard['criterios']
): ChartSeries {
  return {
    labels: criterios.map((item) => item.nome),
    values: criterios.map((item) => item.percentualAcerto)
  };
}

export function concordanciaChartSeries(
  porCriterio: Dashboard['concordancia']['porCriterio']
): ChartSeries {
  return {
    labels: porCriterio.map((item) => item.nome),
    values: porCriterio.map((item) => item.percentual)
  };
}
