const dateTime =
  typeof Intl !== 'undefined'
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo'
      })
    : null;

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'Não informado';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Data inválida';
  }
  return dateTime
    ? dateTime.format(parsed)
    : parsed.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function formatAtendimentoDate(atendimento: {
  concluidoEm?: string | null;
  iniciadoEm?: string | null;
}): string {
  return formatDate(atendimento.concluidoEm ?? atendimento.iniciadoEm);
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return 'Não disponível';
  }
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export function formatNotaIa(nota: number | null): string {
  return nota === null ? '—' : nota.toLocaleString('pt-BR');
}
