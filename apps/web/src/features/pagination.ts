export const PAGE_SIZE = 50;
export const MAX_OFFSET = 10_000;
export const MAX_PAGE = Math.floor(MAX_OFFSET / PAGE_SIZE) + 1;

export function pageFromSearch(searchParams: URLSearchParams): number {
  const requested = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));
  if (!Number.isFinite(requested)) return 1;
  return Math.min(requested, MAX_PAGE);
}

export function resolvePage(
  requestedPage: number,
  total: number,
  itemCount?: number,
  pageSize = PAGE_SIZE
): number {
  if (total <= 0) return 1;
  const totalPages = Math.ceil(total / pageSize);
  if (!Number.isFinite(requestedPage) || requestedPage < 1) return 1;

  const page = Math.min(Math.floor(requestedPage), totalPages);
  if (itemCount === 0 && requestedPage <= totalPages && page > 1) {
    return page - 1;
  }
  return page;
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
