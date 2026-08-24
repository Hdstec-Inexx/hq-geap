const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export function formatComentarioAtendimentoHeader(
  agenteNome: string,
  iniciadoEm: string | null,
  concluidoEm: string | null
): string {
  const rawDate = iniciadoEm ?? concluidoEm;
  if (!rawDate) return agenteNome;
  return `${agenteNome} · ${dateTime.format(new Date(rawDate))}`;
}
