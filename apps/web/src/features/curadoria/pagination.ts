import { pageFromSearch } from '../pagination.js';

export {
  compactPageItems,
  MAX_OFFSET as MAX_FILA_OFFSET,
  MAX_PAGE as MAX_FILA_PAGE,
  PAGE_SIZE as FILA_PAGE_SIZE,
  pageFromSearch,
  resolvePage as resolveFilaPage
} from '../pagination.js';

export function curadoriasRealizadasHref(
  basePath: string,
  searchParamsOrPage: URLSearchParams | number,
  page?: number
): string {
  if (typeof searchParamsOrPage === 'number') {
    return searchParamsOrPage <= 1
      ? basePath
      : `${basePath}?page=${searchParamsOrPage}`;
  }
  const next = new URLSearchParams(searchParamsOrPage);
  const targetPage = page !== undefined ? page : pageFromSearch(searchParamsOrPage);
  if (targetPage <= 1) {
    next.delete('page');
  } else {
    next.set('page', String(targetPage));
  }
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function filaHref(
  searchParamsOrPage: URLSearchParams | number,
  page?: number
): string {
  return curadoriasRealizadasHref('/curadoria', searchParamsOrPage, page);
}

export function reviewHref(
  atendimentoId: string,
  searchParamsOrPage: URLSearchParams | number,
  fromPath?: string
): string {
  if (typeof searchParamsOrPage === 'number') {
    const next = new URLSearchParams();
    if (searchParamsOrPage > 1) next.set('page', String(searchParamsOrPage));
    if (fromPath) next.set('from', fromPath);
    const query = next.toString();
    return query
      ? `/curadoria/${atendimentoId}?${query}`
      : `/curadoria/${atendimentoId}`;
  }
  const next = new URLSearchParams(searchParamsOrPage);
  if (fromPath) {
    next.set('from', fromPath);
  }
  const query = next.toString();
  return query
    ? `/curadoria/${atendimentoId}?${query}`
    : `/curadoria/${atendimentoId}`;
}


