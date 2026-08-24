import type {
  FiltroStatusComentario,
  StatusComentario
} from '@hq-geap/contracts/comentarios';

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

export function isMaintenanceQueueOrigin(from: string | null | undefined): boolean {
  if (!from) return false;
  return (
    from === '/admin/comentarios' ||
    from.startsWith('/admin/comentarios?')
  );
}

export function buildFilaAtendimentoHref(
  atendimentoId: string,
  searchParams: URLSearchParams
): string {
  const searchString = searchParams.toString();
  const fromPath = `/admin/comentarios${searchString ? `?${searchString}` : ''}`;
  const query = new URLSearchParams({ from: fromPath });
  return `/atendimentos/${atendimentoId}?${query.toString()}`;
}

export function getAtendimentoBackLink(
  searchParams: URLSearchParams
): { to: string; label: string } {
  const from = searchParams.get('from');
  if (isMaintenanceQueueOrigin(from)) {
    return {
      to: from!,
      label: 'Voltar à Fila de Manutenção'
    };
  }

  const cleanParams = new URLSearchParams(searchParams);
  cleanParams.delete('from');
  const searchString = cleanParams.toString();

  return {
    to: searchString ? `/atendimentos?${searchString}` : '/atendimentos',
    label: 'Voltar à lista'
  };
}

export type QueueFilters = Pick<
  FiltroStatusComentario,
  'status' | 'inicio' | 'fim' | 'conversationId'
>;

export function extractQueueFiltersFromFromParam(from: string): QueueFilters {
  const queryIndex = from.indexOf('?');
  const searchParams =
    queryIndex !== -1
      ? new URLSearchParams(from.slice(queryIndex + 1))
      : new URLSearchParams();

  const rawStatus = searchParams.get('status');
  const status: StatusComentario =
    rawStatus === 'resolvido' ? 'resolvido' : 'pendente';
  const inicio = searchParams.get('inicio') || undefined;
  const fim = searchParams.get('fim') || undefined;
  const conversationId = searchParams.get('conversationId') || undefined;

  return {
    status,
    inicio,
    fim,
    conversationId
  };
}

export function determineQueueAdvanceTarget(
  currentAtendimentoId: string,
  queueItems: Array<{ atendimento: { id: string } }>,
  fromUrl: string
): { type: 'advance'; to: string } | { type: 'return_to_queue'; to: string } {
  const nextItem = queueItems.find(
    (item) => item.atendimento.id !== currentAtendimentoId
  );

  if (nextItem) {
    const query = new URLSearchParams({ from: fromUrl });
    return {
      type: 'advance',
      to: `/atendimentos/${nextItem.atendimento.id}?${query.toString()}`
    };
  }

  return {
    type: 'return_to_queue',
    to: fromUrl
  };
}

export function countPendingComentarios(
  comentarios: Array<{ status: string }>
): number {
  return comentarios.filter((c) => c.status === 'pendente').length;
}

