import {
  monitoramentoConversasSchema,
  type MonitoramentoConversa
} from '@hq-geap/contracts/monitoramento';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, getSession } from '../auth/session';

const LIST_REFRESH_MS = 10_000;

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: MonitoramentoConversa[] };

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value))
    : 'Início não informado';
}

function formatStatus(status: MonitoramentoConversa['status']) {
  switch (status) {
    case 'in-progress':
      return 'Em progresso';
    case 'initiated':
      return 'Iniciada';
  }
}

export function MonitoramentoPage() {
  const [state, setState] = useState<ListState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    const abortController = new AbortController();

    async function load(showLoading: boolean) {
      const session = getSession();
      if (!session) {
        if (!cancelled) setState({ status: 'error' });
        return;
      }
      if (showLoading) setState({ status: 'loading' });

      try {
        const response = await fetch(`${apiUrl}/monitoramento/conversas`, {
          headers: { authorization: `Bearer ${session.token}` },
          signal: abortController.signal
        });
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }
        const data = monitoramentoConversasSchema.parse(await response.json());
        if (!cancelled) setState({ status: 'ready', data });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        // Soft-fail on refresh: keep the last good snapshot for the Curador.
        if (!cancelled && showLoading) setState({ status: 'error' });
      }
    }

    async function poll() {
      await load(true);
      while (!cancelled) {
        await new Promise<void>((resolve) => {
          refreshTimer = window.setTimeout(resolve, LIST_REFRESH_MS);
        });
        if (cancelled) return;
        await load(false);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      abortController.abort();
    };
  }, []);

  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Operação / tempo real</p>
          <h1>Monitoramento ao Vivo</h1>
          <p className="summary">
            Observe conversas em andamento na ElevenLabs. Somente leitura — sem
            áudio e sem intervenção.
          </p>
        </div>
        <Link className="back-link" to="/">Voltar ao início</Link>
      </header>

      {state.status === 'loading' ? (
        <p className="atendimentos-state">Carregando conversas em andamento...</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível listar as conversas ao vivo. Verifique
          ELEVENLABS_API_KEY e a conectividade com a ElevenLabs.
        </p>
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <p className="atendimentos-state">Nenhuma conversa em andamento agora.</p>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <div className="atendimentos-list">
          {state.data.map((conversa) => (
            <article className="atendimento-row" key={conversa.conversationId}>
              <div className="atendimento-row-main">
                <span className="atendimento-status em_andamento">
                  {formatStatus(conversa.status)}
                </span>
                <Link to={`/monitoramento/${conversa.conversationId}`}>
                  {conversa.conversationId}
                </Link>
                <span>
                  {conversa.agenteVozNome ?? conversa.agentId}
                </span>
              </div>
              <dl className="atendimento-row-data">
                <div>
                  <dt>Início</dt>
                  <dd>{formatDate(conversa.iniciadoEm)}</dd>
                </div>
                <div>
                  <dt>Ação</dt>
                  <dd>
                    <Link to={`/monitoramento/${conversa.conversationId}`}>
                      Observar
                    </Link>
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}
