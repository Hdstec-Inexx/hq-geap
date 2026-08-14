export const FILA_PAGE_SIZE = 50;
export const MAX_FILA_OFFSET = 10_000;
export const MAX_FILA_PAGE = Math.floor(MAX_FILA_OFFSET / FILA_PAGE_SIZE) + 1;

export function pageFromSearch(searchParams: URLSearchParams): number {
  const requested = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));
  if (!Number.isFinite(requested)) return 1;
  return Math.min(requested, MAX_FILA_PAGE);
}

export function resolveFilaPage(requestedPage: number, total: number): number {
  if (total <= 0) return 1;
  const totalPages = Math.ceil(total / FILA_PAGE_SIZE);
  if (!Number.isFinite(requestedPage) || requestedPage < 1) return 1;
  return Math.min(Math.floor(requestedPage), totalPages);
}

export function compactPageItems(
  current: number,
  totalPages: number
): Array<number | 'ellipsis'> {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const windowStart = Math.max(1, Math.min(current - 1, totalPages - 2));
  const windowEnd = Math.min(totalPages, Math.max(current + 1, 3));
  const pages = new Set<number>([1, totalPages]);
  for (let page = windowStart; page <= windowEnd; page += 1) {
    pages.add(page);
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const items: Array<number | 'ellipsis'> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index]!;
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous > 1) {
      if (page - previous === 2) {
        items.push(previous + 1);
      } else {
        items.push('ellipsis');
      }
    }
    items.push(page);
  }
  return items;
}

export function filaHref(page: number): string {
  return page <= 1 ? '/curadoria' : `/curadoria?page=${page}`;
}

export function reviewHref(atendimentoId: string, page: number): string {
  return page <= 1
    ? `/curadoria/${atendimentoId}`
    : `/curadoria/${atendimentoId}?page=${page}`;
}
