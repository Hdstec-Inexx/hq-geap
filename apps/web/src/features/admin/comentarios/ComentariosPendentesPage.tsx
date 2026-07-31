import {
  comentarioSchema,
  comentariosFilaPageSchema,
  type Comentario,
  type ComentarioFila,
  type StatusComentario
} from '@hq-geap/contracts/comentarios';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, getSession } from '../../auth/session';
import { ComentarioCard } from '../../comentarios/ComentarioCard';

function FilaItem({
  comentario,
  onResolved
}: {
  comentario: ComentarioFila;
  onResolved: (comentario: Comentario) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function resolve() {
    const session = getSession();
    if (!session) return;
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(`${apiUrl}/comentarios/${comentario.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${session.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ status: 'resolvido' })
      });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      onResolved(comentarioSchema.parse(await response.json()));
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  return (
    <ComentarioCard
      cabecalho={
        <div className="manutencao-item-heading">
          <div>
            <p className="panel-label">{comentario.atendimento.agenteVozNome}</p>
            <Link to={`/atendimentos/${comentario.atendimento.id}`}>
              {comentario.atendimento.conversationId}
            </Link>
          </div>
        </div>
      }
      className="manutencao-item"
      comentario={comentario}
    >
      {comentario.status === 'pendente' ? (
        <div className="manutencao-actions">
          <span aria-live="polite">
            {error ? 'Não foi possível resolver o comentário.' : null}
          </span>
          <button
            className="primary-action"
            disabled={saving}
            onClick={resolve}
            type="button"
          >
            {saving ? 'Resolvendo...' : 'Marcar como resolvido'}
          </button>
        </div>
      ) : null}
    </ComentarioCard>
  );
}

async function fetchQueuePage(
  status: StatusComentario,
  cursor?: string,
  signal?: AbortSignal
) {
  const session = getSession();
  if (!session) throw new Error('Authentication required');
  const query = new URLSearchParams({ status, limite: '50' });
  if (cursor) query.set('cursor', cursor);
  const response = await fetch(`${apiUrl}/comentarios?${query}`, {
    headers: { authorization: `Bearer ${session.token}` },
    signal
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return comentariosFilaPageSchema.parse(await response.json());
}

export function ComentariosPendentesPage() {
  const [status, setStatus] = useState<StatusComentario>('pendente');
  const statusRef = useRef(status);
  const [items, setItems] = useState<ComentarioFila[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setNextCursor(null);
    setLoadState('loading');
    fetchQueuePage(status, undefined, controller.signal)
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setLoadState('error');
        }
      });
    return () => controller.abort();
  }, [status]);

  async function loadMore() {
    if (!nextCursor) return;
    const requestedStatus = status;
    setLoadState('loading');
    try {
      const page = await fetchQueuePage(requestedStatus, nextCursor);
      if (statusRef.current !== requestedStatus) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch {
      if (statusRef.current === requestedStatus) {
        setLoadState('error');
      }
    }
  }

  function removeResolved(resolved: Comentario) {
    setItems((current) =>
      current.filter((comentario) => comentario.id !== resolved.id)
    );
  }

  function changeStatus(nextStatus: StatusComentario) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  return (
    <main className="atendimentos-page manutencao-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Administração / Agente de Voz</p>
          <h1>Fila de manutenção</h1>
          <p>Trabalhe os comentários usados para melhorar continuamente o agente.</p>
        </div>
        <label className="manutencao-filter">
          Status
          <select
            onChange={(event) =>
              changeStatus(event.target.value as StatusComentario)
            }
            value={status}
          >
            <option value="pendente">Pendente</option>
            <option value="resolvido">Resolvido</option>
          </select>
        </label>
      </header>

      {loadState === 'loading' && items.length === 0 ? (
        <p>Carregando fila...</p>
      ) : null}
      {loadState === 'error' ? <p>Não foi possível carregar a fila.</p> : null}
      {loadState === 'ready' && items.length === 0 && !nextCursor ? (
        <section className="manutencao-empty">
          <h2>Nenhum comentário {status}</h2>
          <p>A fila está em dia para este status.</p>
        </section>
      ) : null}
      {items.length > 0 || nextCursor ? (
        <section className="manutencao-lista" aria-label="Comentários da fila">
          {items.map((comentario) => (
            <FilaItem
              comentario={comentario}
              key={comentario.id}
              onResolved={removeResolved}
            />
          ))}
          {nextCursor ? (
            <button
              className="primary-action"
              disabled={loadState === 'loading'}
              onClick={loadMore}
              type="button"
            >
              {loadState === 'loading' ? 'Carregando...' : 'Carregar mais'}
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
