import {
  filaCuradoriaSchema,
  type FilaCuradoriaItem
} from '@hq-geap/contracts/curadoria';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { canWriteAsCurador, usePerfil } from '../auth/perfil-context';
import { formatDuration } from '../atendimentos/atendimento-facts-logic';
import { useAuthenticatedResource } from '../atendimentos/api';
import { formatMotivoContato } from '../atendimentos/motivo-combobox-logic';
import { MotivoCombobox } from '../atendimentos/MotivoCombobox';
import {
  compactPageItems,
  FILA_PAGE_SIZE,
  MAX_FILA_PAGE,
  filaHref,
  pageFromSearch,
  resolveFilaPage,
  reviewHref
} from './pagination';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export function FilaCuradoriaPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedPage = pageFromSearch(searchParams);

  const inicioParam = searchParams.get('inicio') ?? '';
  const fimParam = searchParams.get('fim') ?? '';
  const conversationIdParam = searchParams.get('conversationId') ?? '';
  const motivoParam = searchParams.get('motivo') ?? '';

  const [draftInicio, setDraftInicio] = useState(inicioParam);
  const [draftFim, setDraftFim] = useState(fimParam);
  const [draftConversationId, setDraftConversationId] = useState(conversationIdParam);
  const [draftMotivo, setDraftMotivo] = useState(motivoParam);

  const hasDraftFilters = Boolean(
    draftInicio || draftFim || draftConversationId || draftMotivo
  );
  const hasActiveFilters = Boolean(
    inicioParam || fimParam || conversationIdParam || motivoParam || hasDraftFilters
  );

  useEffect(() => {
    setDraftInicio(inicioParam);
    setDraftFim(fimParam);
    setDraftConversationId(conversationIdParam);
    setDraftMotivo(motivoParam);
  }, [inicioParam, fimParam, conversationIdParam, motivoParam]);

  const query = new URLSearchParams({
    limit: String(FILA_PAGE_SIZE),
    offset: String((requestedPage - 1) * FILA_PAGE_SIZE)
  });
  if (inicioParam) query.set('inicio', inicioParam);
  if (fimParam) query.set('fim', fimParam);
  if (conversationIdParam) query.set('conversationId', conversationIdParam);
  if (motivoParam) query.set('motivo', motivoParam);

  const requestPath = `/curadoria?${query.toString()}`;
  const state = useAuthenticatedResource(requestPath, filaCuradoriaSchema);
  const currentState = state.path === requestPath;
  const canWrite = canWriteAsCurador(usePerfil()?.role);
  const items = state.status === 'ready' && currentState ? state.data.items : [];
  const total = state.status === 'ready' && currentState ? state.data.total : 0;
  const resolvedPage = resolveFilaPage(requestedPage, total, items.length);
  const pageOutOfRange =
    state.status === 'ready' && currentState && resolvedPage !== requestedPage;
  const paginaPronta = state.status === 'ready' && currentState && !pageOutOfRange;
  const totalPages = Math.min(
    Math.ceil(total / FILA_PAGE_SIZE),
    MAX_FILA_PAGE
  );

  useEffect(() => {
    if (state.status !== 'ready' || !currentState) return;
    if (resolvedPage !== requestedPage) {
      navigate(filaHref(searchParams, resolvedPage), { replace: true });
    }
  }, [currentState, navigate, requestedPage, resolvedPage, searchParams, state.status]);

  function handleFilterSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (draftInicio) {
      next.set('inicio', draftInicio);
      if (draftFim && draftFim >= draftInicio) {
        next.set('fim', draftFim);
      }
    }
    if (draftConversationId.trim()) next.set('conversationId', draftConversationId.trim());
    if (draftMotivo.trim()) next.set('motivo', draftMotivo.trim());
    navigate(filaHref(next, 1));
  }

  function handleClearFilters() {
    setDraftInicio('');
    setDraftFim('');
    setDraftConversationId('');
    setDraftMotivo('');
    navigate('/curadoria');
  }

  return (
    <main className="atendimentos-page curadoria-page">
      <header className="atendimentos-heading curadoria-heading">
        <div>
          <p className="eyebrow">Conferência humana</p>
          <h1>Fila de Curadoria</h1>
          <p className="curadoria-intro">
            Atendimentos concluídos aguardando revisão do checklist da IA.
          </p>
          <Link className="back-link" to="/">
            Voltar ao início
          </Link>
        </div>
        {paginaPronta && total > 0 ? (
          <span className="queue-count">
            {items.length} pendente{items.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>

      <form className="curadoria-filters" onSubmit={handleFilterSubmit}>
        <div className="curadoria-filters-fields">
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
              id="curadoria-conversation-id-filtro"
              name="conversationId"
              onChange={(event) => setDraftConversationId(event.target.value)}
              placeholder="Buscar por ID..."
              type="text"
              value={draftConversationId}
            />
          </label>
          <label>
            Motivo de Contato
            <MotivoCombobox
              id="curadoria-motivo-filtro"
              name="motivo"
              onChange={setDraftMotivo}
              placeholder="Todos os motivos"
              value={draftMotivo}
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

      {state.status === 'loading' || !currentState || pageOutOfRange ? (
        <div aria-label="Carregando fila" className="curadoria-skeleton" />
      ) : null}
      {state.status === 'error' && currentState ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar a Fila de Curadoria.
        </p>
      ) : null}
      {paginaPronta && total === 0 ? (
        <section className="curadoria-empty">
          <h2>{hasActiveFilters ? 'Nenhum Atendimento encontrado' : 'Fila em dia'}</h2>
          <p>
            {hasActiveFilters
              ? 'Não há Atendimentos pendentes para os filtros selecionados.'
              : 'Não há Atendimentos aguardando conferência humana.'}
          </p>
        </section>
      ) : null}
      {paginaPronta && items.length > 0 ? (
        <section aria-label="Atendimentos pendentes" className="curadoria-list">
          {items.map((item: FilaCuradoriaItem) => (
            <article className="curadoria-row" key={item.id}>
              <div className="curadoria-row-main">
                <span>{item.agenteVozNome}</span>
                <Link to={reviewHref(item.id, searchParams)}>
                  {item.conversationId}
                </Link>
                <small>{dateTime.format(new Date(item.concluidoEm))}</small>
              </div>
              <dl>
                <div><dt>Motivo</dt><dd>{formatMotivoContato(item.motivoContato)}</dd></div>
                <div><dt>Duração</dt><dd>{formatDuration(item.duracaoSegundos)}</dd></div>
                <div><dt>Nota da IA Avaliadora</dt><dd>{item.notaIa.toLocaleString('pt-BR')}</dd></div>
              </dl>
              <Link className="review-link" to={reviewHref(item.id, searchParams)}>
                {canWrite ? 'Conferir' : 'Consultar'}
              </Link>
            </article>
          ))}
          {totalPages > 1 ? (
            <nav
              aria-label="Paginação da Fila de Curadoria"
              className="curadoria-pagination"
            >
              {requestedPage > 1 ? (
                <Link to={filaHref(searchParams, requestedPage - 1)}>Página anterior</Link>
              ) : (
                <span />
              )}
              <ol>
                {compactPageItems(requestedPage, totalPages).map((item, index) =>
                  item === 'ellipsis' ? (
                    <li key={`ellipsis-${index}`}>
                      <span aria-hidden="true">…</span>
                    </li>
                  ) : item === requestedPage ? (
                    <li key={item}>
                      <span aria-current="page" aria-label={`Página ${item}`}>
                        {item}
                      </span>
                    </li>
                  ) : (
                    <li key={item}>
                      <Link aria-label={`Página ${item}`} to={filaHref(searchParams, item)}>
                        {item}
                      </Link>
                    </li>
                  )
                )}
              </ol>
              {requestedPage < totalPages ? (
                <Link to={filaHref(searchParams, requestedPage + 1)}>Próxima página</Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
