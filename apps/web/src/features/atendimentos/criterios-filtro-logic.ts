export type CriterioOption = {
  id?: string;
  chave?: string;
  nome: string;
  critico?: boolean;
};

export function parseCriteriaParam(
  searchParams: URLSearchParams,
  key: string
): string[] {
  const all = searchParams.getAll(key);
  if (all.length === 0) return [];
  const normalized = all
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

export function formatSelectedCriteriaLabel(
  selectedIds: string[],
  criterios: CriterioOption[],
  placeholder = 'Todos os critérios'
): string {
  if (selectedIds.length === 0) {
    return placeholder;
  }
  if (selectedIds.length === 1) {
    const found = criterios.find((c) => c.id === selectedIds[0]);
    return found?.nome ?? '1 selecionado';
  }
  return `${selectedIds.length} selecionados`;
}
