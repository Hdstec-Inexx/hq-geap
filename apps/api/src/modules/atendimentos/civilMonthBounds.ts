export type CivilMonthBounds = {
  inicio: string;
  fim: string;
};

export function civilMonthBoundsAmericaSaoPaulo(now = new Date()): CivilMonthBounds {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    inicio: `${year}-${String(month).padStart(2, '0')}-01`,
    fim: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  };
}

export function civilDayRangeSql(
  column: string,
  inicioPlaceholder: string,
  fimPlaceholder: string
): string {
  return `${column} at time zone 'America/Sao_Paulo' >= ${inicioPlaceholder}::date and ${column} at time zone 'America/Sao_Paulo' < ${fimPlaceholder}::date + interval '1 day'`;
}
