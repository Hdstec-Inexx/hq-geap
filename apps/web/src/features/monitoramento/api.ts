import { apiUrl, getSession } from '../auth/session';

export function monitoramentoWsUrl(atendimentoId: string) {
  const session = getSession();
  if (!session) {
    throw new Error('Sessão necessária para o Monitoramento ao Vivo');
  }
  const base = new URL(apiUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `/atendimentos/${encodeURIComponent(atendimentoId)}/monitoramento`;
  base.search = `token=${encodeURIComponent(session.token)}`;
  base.hash = '';
  return base.toString();
}
