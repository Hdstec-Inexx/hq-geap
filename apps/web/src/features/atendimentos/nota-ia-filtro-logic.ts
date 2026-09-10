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

export function notaMinQueryForRequest(
  searchParams: URLSearchParams
): string | undefined {
  const parsed = parseNotaMinParam(searchParams);
  if (parsed <= 0) {
    return undefined;
  }
  return String(parsed);
}

export function formatNotaMinDisplay(notaMin: number): string {
  return notaMin.toLocaleString('pt-BR');
}
