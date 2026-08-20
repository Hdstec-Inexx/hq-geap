import { MOTIVO_NAO_INFORMADO } from '@hq-geap/contracts/atendimentos';

export function normalizeMotivoText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function filterMotivoOptions(
  options: string[],
  search: string
): string[] {
  const normalizedSearch = normalizeMotivoText(search.trim());
  if (!normalizedSearch) return options;
  return options.filter((option) =>
    normalizeMotivoText(option).includes(normalizedSearch)
  );
}

export function formatMotivoContato(motivo: string | null | undefined): string {
  const trimmed = motivo?.trim();
  if (!trimmed || trimmed === 'Nao informado' || trimmed === 'Não informado') {
    return MOTIVO_NAO_INFORMADO;
  }
  return trimmed;
}
