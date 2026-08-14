export {
  compactPageItems,
  MAX_OFFSET as MAX_FILA_OFFSET,
  MAX_PAGE as MAX_FILA_PAGE,
  PAGE_SIZE as FILA_PAGE_SIZE,
  pageFromSearch,
  resolvePage as resolveFilaPage
} from '../pagination.js';

export function filaHref(page: number): string {
  return page <= 1 ? '/curadoria' : `/curadoria?page=${page}`;
}

export function reviewHref(atendimentoId: string, page: number): string {
  return page <= 1
    ? `/curadoria/${atendimentoId}`
    : `/curadoria/${atendimentoId}?page=${page}`;
}
