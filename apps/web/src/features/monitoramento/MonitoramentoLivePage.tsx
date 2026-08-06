import {
  monitoramentoEventSchema,
  type MonitoramentoEvent
} from '@hq-geap/contracts/monitoramento';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { monitoramentoAuthPayload, monitoramentoWsUrl } from './api';

const maxLiveLines = 200;
const nearBottomPx = 80;

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
  const { conversationId = '' } = useParams();
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'connecting'
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (!conversationId) {
      setConnection({
        status: 'error',
        message: 'Conversa não informada'
      });
      return;
    }

    let socket: WebSocket;
    let nextId = 0;
    let sawReady = false;
    let sawTerminal = false;
    try {
      socket = new WebSocket(monitoramentoWsUrl(conversationId));
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
    stickToBottomRef.current = true;

    socket.addEventListener('open', () => {
      try {
        socket.send(monitoramentoAuthPayload());
      } catch (error) {
        sawTerminal = true;
        setConnection({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Sessão necessária para o Monitoramento ao Vivo'
        });
        socket.close();
      }
    });

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
      if (sawTerminal) {
        return;
      }
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
      if (sawTerminal) {
        return;
      }
      setConnection((current) => {
        if (current.status === 'error' || current.status === 'ended') {
          return current;
        }
        if (!sawReady) {
          return {
            status: 'error',
            message: 'Não foi possível iniciar o Monitoramento ao Vivo'
          };
        }
        return { status: 'ended' };
      });
    });

    function applyEvent(event: MonitoramentoEvent) {
      if (event.type === 'ready') {
        sawReady = true;
        setConnection({ status: 'live' });
        return;
      }
      if (event.type === 'transcript') {
        const id = nextId++;
        sawReady = true;
        setConnection({ status: 'live' });
        setLines((current) => {
          const next = [
            ...current,
            { id, role: event.role, message: event.message }
          ];
          return next.length > maxLiveLines
            ? next.slice(next.length - maxLiveLines)
            : next;
        });
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
        sawTerminal = true;
        setConnection({ status: 'ended' });
        return;
      }
      sawTerminal = true;
      setConnection({ status: 'error', message: event.message });
    }

    return () => {
      socket.close();
    };
  }, [conversationId]);

  return (
    <main className="atendimentos-page atendimento-detail">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Monitoramento ao Vivo / somente observação</p>
          <h1>Transcrição em tempo real</h1>
          <p className="atendimento-id">{conversationId}</p>
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
        <div
          className="transcript-lines monitoramento-transcript-scroll"
          data-testid="monitoramento-transcript-scroll"
          onScroll={(event) => {
            const el = event.currentTarget;
            const distance =
              el.scrollHeight - el.scrollTop - el.clientHeight;
            stickToBottomRef.current = distance <= nearBottomPx;
          }}
          ref={scrollRef}
        >
          {lines.length === 0 ? (
            <p>Aguardando falas do Atendimento...</p>
          ) : (
            lines.map((line) => (
              <article
                className={`transcript-line transcript-${line.role}`}
                key={line.id}
              >
                <span>{line.role === 'agent' ? 'Agente' : 'Cliente'}</span>
                <p>{line.message}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
