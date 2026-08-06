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
    let releaseVisibilityWait: (() => void) | undefined;
    const abortController = new AbortController();

    function delay(ms: number) {
      return new Promise<void>((resolve) => {
        refreshTimer = window.setTimeout(resolve, ms);
      });
    }

    function whenVisible() {
      if (document.visibilityState === 'visible') return Promise.resolve();
      return new Promise<void>((resolve) => {
        function onVisibility() {
          if (document.visibilityState !== 'visible') return;
          document.removeEventListener('visibilitychange', onVisibility);
          releaseVisibilityWait = undefined;
          resolve();
        }
        releaseVisibilityWait = () => {
          document.removeEventListener('visibilitychange', onVisibility);
          releaseVisibilityWait = undefined;
          resolve();
        };
        document.addEventListener('visibilitychange', onVisibility);
      });
    }

    async function load(isInitial: boolean) {
      const session = getSession();
      if (!session) {
        if (!cancelled) setState({ status: 'error' });
        return 'auth' as const;
      }
      if (isInitial) setState({ status: 'loading' });

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
        return 'ok' as const;
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return 'aborted' as const;
        }
        // Soft-fail on refresh: keep the last good snapshot for the Curador.
        if (!cancelled && isInitial) setState({ status: 'error' });
        return 'error' as const;
      }
    }

    async function poll() {
      const first = await load(true);
      if (cancelled || first === 'auth') return;
      while (!cancelled) {
        await delay(LIST_REFRESH_MS);
        if (cancelled) return;
        // Skip ElevenLabs-backed refreshes while the Curador is on another tab.
        await whenVisible();
        if (cancelled) return;
        const result = await load(false);
        if (result === 'auth') return;
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      releaseVisibilityWait?.();
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
