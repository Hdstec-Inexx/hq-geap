import type { DetalhamentoIndicador } from '@hq-geap/contracts/atendimentos';

export type DetalhamentoParams = {
  inicio: string;
  fim: string;
  indicador: DetalhamentoIndicador;
  motivo?: string;
  criterioId?: string;
};

/** Monta a URL da lista de Atendimentos com filtros compartilháveis do Detalhamento. */
export function detalhamentoListPath(params: DetalhamentoParams): string {
  const search = new URLSearchParams({
    inicio: params.inicio,
    fim: params.fim,
    indicador: params.indicador
  });
  if (params.motivo) {
    search.set('motivo', params.motivo);
  }
  if (params.criterioId) {
    search.set('criterioId', params.criterioId);
  }
  return `/atendimentos?${search.toString()}`;
}

export function detalhamentoQueryFromSearch(
  searchParams: URLSearchParams
): string {
  const params = new URLSearchParams();
  for (const key of [
    'inicio',
    'fim',
    'indicador',
    'motivo',
    'criterioId',
    'status'
  ] as const) {
    const value = searchParams.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  return params.toString();
}
