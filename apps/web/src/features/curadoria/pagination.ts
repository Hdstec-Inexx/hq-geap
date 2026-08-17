import { pageFromSearch } from '../pagination.js';

export {
  compactPageItems,
  MAX_OFFSET as MAX_FILA_OFFSET,
  MAX_PAGE as MAX_FILA_PAGE,
  PAGE_SIZE as FILA_PAGE_SIZE,
  pageFromSearch,
  resolvePage as resolveFilaPage
} from '../pagination.js';

export function filaHref(
  searchParamsOrPage: URLSearchParams | number,
  page?: number
): string {
  if (typeof searchParamsOrPage === 'number') {
    return searchParamsOrPage <= 1
      ? '/curadoria'
      : `/curadoria?page=${searchParamsOrPage}`;
  }
  const next = new URLSearchParams(searchParamsOrPage);
  const targetPage = page !== undefined ? page : pageFromSearch(searchParamsOrPage);
  if (targetPage <= 1) {
    next.delete('page');
  } else {
    next.set('page', String(targetPage));
  }
  const query = next.toString();
  return query ? `/curadoria?${query}` : '/curadoria';
}

export function reviewHref(
  atendimentoId: string,
  searchParamsOrPage: URLSearchParams | number
): string {
  if (typeof searchParamsOrPage === 'number') {
    return searchParamsOrPage <= 1
      ? `/curadoria/${atendimentoId}`
      : `/curadoria/${atendimentoId}?page=${searchParamsOrPage}`;
  }
  const query = searchParamsOrPage.toString();
  return query
    ? `/curadoria/${atendimentoId}?${query}`
    : `/curadoria/${atendimentoId}`;
}
