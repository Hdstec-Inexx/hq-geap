import {
  atendimentoDetailSchema
} from '@hq-geap/contracts/atendimentos';
import {
  monitoramentoEventSchema,
  type MonitoramentoEvent
} from '@hq-geap/contracts/monitoramento';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthenticatedResource } from '../atendimentos/api';
import { monitoramentoWsUrl } from './api';

type LiveLine = {
  id: number;
  role: 'agent' | 'user';
  message: string;
};

type ConnectionState =
  | { status: 'connecting' }
  | { status: 'live' }
  | { status: 'ended' }
  | { status: 'error'; message: string };

export function MonitoramentoLivePage() {
  const { atendimentoId = '' } = useParams();
  const detail = useAuthenticatedResource(
    `/atendimentos/${atendimentoId}`,
    atendimentoDetailSchema
  );
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'connecting'
  });

  useEffect(() => {
    if (!atendimentoId) {
      setConnection({
        status: 'error',
        message: 'Atendimento não informado'
      });
      return;
    }

    let socket: WebSocket;
    let nextId = 0;
    try {
      socket = new WebSocket(monitoramentoWsUrl(atendimentoId));
    } catch (error) {
      setConnection({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível abrir o Monitoramento ao Vivo'
      });
      return;
    }

    setConnection({ status: 'connecting' });
    setLines([]);

    socket.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = monitoramentoEventSchema.safeParse(parsed);
      if (!message.success) {
        return;
      }
      applyEvent(message.data);
    });

    socket.addEventListener('error', () => {
      setConnection((current) =>
        current.status === 'error'
          ? current
          : {
              status: 'error',
              message: 'Falha na conexão do Monitoramento ao Vivo'
            }
      );
    });

    socket.addEventListener('close', () => {
      setConnection((current) =>
        current.status === 'error' || current.status === 'ended'
          ? current
          : { status: 'ended' }
      );
    });

    function applyEvent(event: MonitoramentoEvent) {
      if (event.type === 'ready') {
        setConnection({ status: 'live' });
        return;
      }
      if (event.type === 'transcript') {
        const id = nextId++;
        setConnection({ status: 'live' });
        setLines((current) => [
          ...current,
          { id, role: event.role, message: event.message }
        ]);
        return;
      }
      if (event.type === 'correction') {
        setLines((current) => {
          if (current.length === 0) {
            return current;
          }
          const next = [...current];
          const last = next[next.length - 1]!;
          if (last.role === 'agent') {
            next[next.length - 1] = { ...last, message: event.message };
          }
          return next;
        });
        return;
      }
      if (event.type === 'ended') {
        setConnection({ status: 'ended' });
        return;
      }
      setConnection({ status: 'error', message: event.message });
    }

    return () => {
      socket.close();
    };
  }, [atendimentoId]);

  const agenteNome =
    detail.status === 'ready' ? detail.data.agenteVoz.nome : 'Agente de Voz';

  return (
    <main className="atendimentos-page atendimento-detail">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Monitoramento ao Vivo / somente observação</p>
          <h1>Transcrição em tempo real</h1>
          <p className="atendimento-id">
            {detail.status === 'ready'
              ? detail.data.conversationId
              : atendimentoId}
          </p>
        </div>
        <Link className="back-link" to="/monitoramento">
          Voltar à lista
        </Link>
      </header>

      <p
        className={
          connection.status === 'error'
            ? 'atendimentos-state atendimentos-state-error'
            : 'atendimentos-state'
        }
        role="status"
      >
        {connection.status === 'connecting'
          ? 'Conectando ao monitoramento...'
          : null}
        {connection.status === 'live' ? 'Observando em tempo real.' : null}
        {connection.status === 'ended' ? 'Monitoramento encerrado.' : null}
        {connection.status === 'error' ? connection.message : null}
      </p>

      <section className="transcript-panel monitoramento-live-panel">
        <p className="panel-label">Transcrição ao vivo</p>
        <div className="transcript-lines">
          {lines.length === 0 ? (
            <p>Aguardando falas do Atendimento...</p>
          ) : (
            lines.map((line) => (
              <article
                className={`transcript-line transcript-${line.role}`}
                key={line.id}
              >
                <span>{line.role === 'agent' ? agenteNome : 'Cliente'}</span>
                <p>{line.message}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
