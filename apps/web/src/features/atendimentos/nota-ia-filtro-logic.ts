import { notaMinQueryFilterSchema } from '@hq-geap/contracts/atendimentos';

export function parseNotaMinParam(searchParams: URLSearchParams): number {
  const parsed = notaMinQueryFilterSchema.safeParse(
    searchParams.get('notaMin') ?? undefined
  );
  if (!parsed.success || parsed.data === undefined) {
    return 0;
  }
  return parsed.data;
}

export function isInvalidNotaMinParam(searchParams: URLSearchParams): boolean {
  const raw = searchParams.get('notaMin');
  if (raw === null || raw === '') {
    return false;
  }
  return !notaMinQueryFilterSchema.safeParse(raw).success;
}

export function stripInvalidNotaMin(
  searchParams: URLSearchParams
): URLSearchParams | null {
  if (!isInvalidNotaMinParam(searchParams)) {
    return null;
  }
  const next = new URLSearchParams(searchParams);
  next.delete('notaMin');
  return next;
}

export function notaMinQueryForRequest(
  searchParams: URLSearchParams
): string | undefined {
  const parsed = parseNotaMinParam(searchParams);
  if (parsed <= 0) {
    return undefined;
  }
  return String(parsed);
}

export function applyNotaMinQuery(
  target: URLSearchParams,
  searchParams: URLSearchParams
): void {
  const value = notaMinQueryForRequest(searchParams);
  if (value) {
    target.set('notaMin', value);
  }
}

export function applyDraftNotaMin(
  target: URLSearchParams,
  draftNotaMin: number
): void {
  if (draftNotaMin > 0) {
    target.set('notaMin', String(draftNotaMin));
  }
}

export function notaMinFilterActive(
  notaMinParam: number,
  notaMinQuery?: string
): boolean {
  return notaMinParam > 0 || Boolean(notaMinQuery);
}

export function formatNotaMinDisplay(notaMin: number): string {
  return notaMin.toLocaleString('pt-BR');
}
