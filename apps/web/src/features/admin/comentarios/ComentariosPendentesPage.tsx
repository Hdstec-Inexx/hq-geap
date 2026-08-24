import {
  comentarioSchema,
  comentariosFilaPageSchema,
  type Comentario,
  type ComentarioFila,
  type FiltroStatusComentario,
  type StatusComentario
} from '@hq-geap/contracts/comentarios';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiUrl, getSession } from '../../auth/session';
import { ComentarioCard } from '../../comentarios/ComentarioCard';
import { formatComentarioAtendimentoHeader } from './comentarios-fila-logic';

export type QueueFilters = Pick<
  FiltroStatusComentario,
  'status' | 'inicio' | 'fim' | 'conversationId'
>;

function FilaItem({
  comentario,
  onResolved
}: {
  comentario: ComentarioFila;
  onResolved: (comentario: Comentario) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const headerLabel = formatComentarioAtendimentoHeader(
    comentario.atendimento.agenteVozNome,
    comentario.atendimento.iniciadoEm,
    comentario.atendimento.concluidoEm
  );

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
            <p className="panel-label">{headerLabel}</p>
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
  filters: QueueFilters,
  cursor?: string,
  signal?: AbortSignal
) {
  const session = getSession();
  if (!session) throw new Error('Authentication required');
  const query = new URLSearchParams({ status: filters.status, limite: '50' });
  if (filters.inicio) query.set('inicio', filters.inicio);
  if (filters.fim) query.set('fim', filters.fim);
  if (filters.conversationId) query.set('conversationId', filters.conversationId);
  if (cursor) query.set('cursor', cursor);

  const response = await fetch(`${apiUrl}/comentarios?${query.toString()}`, {
    headers: { authorization: `Bearer ${session.token}` },
    signal
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return comentariosFilaPageSchema.parse(await response.json());
}

export function ComentariosPendentesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const activeStatus: StatusComentario =
    rawStatus === 'resolvido' ? 'resolvido' : 'pendente';
  const inicioParam = searchParams.get('inicio') ?? '';
  const fimParam = searchParams.get('fim') ?? '';
  const conversationIdParam = searchParams.get('conversationId') ?? '';

  const [draftStatus, setDraftStatus] = useState<StatusComentario>(activeStatus);
  const [draftInicio, setDraftInicio] = useState(inicioParam);
  const [draftFim, setDraftFim] = useState(fimParam);
  const [draftConversationId, setDraftConversationId] =
    useState(conversationIdParam);

  const [items, setItems] = useState<ComentarioFila[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  const activeFiltersRef = useRef<QueueFilters>({
    status: activeStatus,
    inicio: inicioParam || undefined,
    fim: fimParam || undefined,
    conversationId: conversationIdParam || undefined
  });

  const hasDraftFilters = Boolean(
    draftInicio ||
      draftFim ||
      draftConversationId ||
      draftStatus !== 'pendente'
  );

  const hasActiveFilters = Boolean(
    inicioParam ||
      fimParam ||
      conversationIdParam ||
      activeStatus === 'resolvido' ||
      hasDraftFilters
  );

  useEffect(() => {
    setDraftStatus(activeStatus);
    setDraftInicio(inicioParam);
    setDraftFim(fimParam);
    setDraftConversationId(conversationIdParam);
  }, [activeStatus, inicioParam, fimParam, conversationIdParam]);

  useEffect(() => {
    const currentFilters: QueueFilters = {
      status: activeStatus,
      inicio: inicioParam || undefined,
      fim: inicioParam && fimParam ? fimParam : inicioParam || undefined,
      conversationId: conversationIdParam || undefined
    };
    activeFiltersRef.current = currentFilters;

    const controller = new AbortController();
    setItems([]);
    setNextCursor(null);
    setLoadState('loading');
    fetchQueuePage(currentFilters, undefined, controller.signal)
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
  }, [activeStatus, inicioParam, fimParam, conversationIdParam]);

  async function loadMore() {
    if (!nextCursor) return;
    const filtersToUse = activeFiltersRef.current;
    setLoadState('loading');
    try {
      const page = await fetchQueuePage(filtersToUse, nextCursor);
      if (activeFiltersRef.current !== filtersToUse) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch {
      if (activeFiltersRef.current === filtersToUse) {
        setLoadState('error');
      }
    }
  }

  function removeResolved(resolved: Comentario) {
    setItems((current) =>
      current.filter((comentario) => comentario.id !== resolved.id)
    );
  }

  function handleFilterSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (draftStatus !== 'pendente') {
      next.set('status', draftStatus);
    }
    if (draftInicio) {
      next.set('inicio', draftInicio);
      if (draftFim && draftFim >= draftInicio) {
        next.set('fim', draftFim);
      }
    }
    if (draftConversationId.trim()) {
      next.set('conversationId', draftConversationId.trim());
    }
    setSearchParams(next);
  }

  function handleClearFilters() {
    setDraftStatus('pendente');
    setDraftInicio('');
    setDraftFim('');
    setDraftConversationId('');
    setSearchParams(new URLSearchParams());
  }

  function handleStatusChange(nextStatus: StatusComentario) {
    setDraftStatus(nextStatus);
    const next = new URLSearchParams(searchParams);
    if (nextStatus === 'pendente') {
      next.delete('status');
    } else {
      next.set('status', nextStatus);
    }
    setSearchParams(next);
  }

  return (
    <main className="atendimentos-page manutencao-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Administração / Agente de Voz</p>
          <h1>Fila de manutenção</h1>
          <p>Trabalhe os comentários usados para melhorar continuamente o agente.</p>
          <Link className="back-link" to="/">
            Voltar ao início
          </Link>
        </div>
      </header>

      <form
        className="curadoria-filters manutencao-filters"
        onSubmit={handleFilterSubmit}
      >
        <div className="curadoria-filters-fields">
          <label className="manutencao-filter">
            Status
            <select
              aria-label="Status"
              name="status"
              onChange={(event) =>
                handleStatusChange(event.target.value as StatusComentario)
              }
              value={draftStatus}
            >
              <option value="pendente">Pendente</option>
              <option value="resolvido">Resolvido</option>
            </select>
          </label>
          <label>
            Data inicial
            <input
              name="inicio"
              onChange={(event) => {
                const nextInicio = event.target.value;
                setDraftInicio(nextInicio);
                if (!nextInicio) {
                  setDraftFim('');
                }
              }}
              type="date"
              value={draftInicio}
            />
          </label>
          <span aria-hidden="true" className="curadoria-filters-arrow">
            →
          </span>
          <label>
            Data final (opcional)
            <input
              disabled={!draftInicio}
              min={draftInicio || undefined}
              name="fim"
              onChange={(event) => setDraftFim(event.target.value)}
              type="date"
              value={draftInicio ? draftFim : ''}
            />
          </label>
          <label>
            ID da conversa
            <input
              name="conversationId"
              onChange={(event) => setDraftConversationId(event.target.value)}
              placeholder="Buscar por ID..."
              type="text"
              value={draftConversationId}
            />
          </label>
        </div>
        <div className="curadoria-filters-actions">
          <button className="primary-action" type="submit">
            Filtrar
          </button>
          {hasActiveFilters ? (
            <button
              className="curadoria-filter-clear"
              onClick={handleClearFilters}
              type="button"
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </form>

      {loadState === 'loading' && items.length === 0 ? (
        <p>Carregando fila...</p>
      ) : null}
      {loadState === 'error' ? <p>Não foi possível carregar a fila.</p> : null}
      {loadState === 'ready' && items.length === 0 && !nextCursor ? (
        <section className="manutencao-empty">
          <h2>
            {hasActiveFilters && (inicioParam || fimParam || conversationIdParam)
              ? 'Nenhum comentário encontrado'
              : `Nenhum comentário ${activeStatus}`}
          </h2>
          <p>
            {hasActiveFilters && (inicioParam || fimParam || conversationIdParam)
              ? 'Não há comentários para os filtros selecionados.'
              : 'A fila está em dia para este status.'}
          </p>
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
