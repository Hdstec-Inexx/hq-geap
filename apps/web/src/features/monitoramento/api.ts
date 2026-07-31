import { apiUrl, getSession } from '../auth/session';

export function monitoramentoWsUrl(conversationId: string) {
  const base = new URL(apiUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `/monitoramento/conversas/${encodeURIComponent(conversationId)}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function monitoramentoAuthPayload() {
  const session = getSession();
  if (!session) {
    throw new Error('Sessão necessária para o Monitoramento ao Vivo');
  }
  return JSON.stringify({ type: 'auth', token: session.token });
}
