import {
  filaCuradoriaSchema,
  type FilaCuradoriaItem
} from '@hq-geap/contracts/curadoria';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { canWriteAsCurador, usePerfil } from '../auth/perfil-context';
import { formatDuration, useAuthenticatedResource } from '../atendimentos/api';
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
  const requestPath = `/curadoria?limit=${FILA_PAGE_SIZE}&offset=${(requestedPage - 1) * FILA_PAGE_SIZE}`;
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
      navigate(filaHref(resolvedPage), { replace: true });
    }
  }, [currentState, navigate, requestedPage, resolvedPage, state.status]);

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

      {state.status === 'loading' || !currentState || pageOutOfRange ? (
        <div className="curadoria-skeleton" aria-label="Carregando fila" />
      ) : null}
      {state.status === 'error' && currentState ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar a Fila de Curadoria.
        </p>
      ) : null}
      {paginaPronta && total === 0 ? (
        <section className="curadoria-empty">
          <h2>Fila em dia</h2>
          <p>Não há Atendimentos aguardando conferência humana.</p>
        </section>
      ) : null}
      {paginaPronta && items.length > 0 ? (
        <section className="curadoria-list" aria-label="Atendimentos pendentes">
          {items.map((item: FilaCuradoriaItem) => (
            <article className="curadoria-row" key={item.id}>
              <div className="curadoria-row-main">
                <span>{item.agenteVozNome}</span>
                <Link to={reviewHref(item.id, requestedPage)}>
                  {item.conversationId}
                </Link>
                <small>{dateTime.format(new Date(item.concluidoEm))}</small>
              </div>
              <dl>
                <div><dt>Motivo</dt><dd>{item.motivoContato ?? 'Não informado'}</dd></div>
                <div><dt>Duração</dt><dd>{formatDuration(item.duracaoSegundos)}</dd></div>
                <div><dt>Nota IA</dt><dd>{item.notaIa.toLocaleString('pt-BR')}</dd></div>
              </dl>
              <Link className="review-link" to={reviewHref(item.id, requestedPage)}>
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
                <Link to={filaHref(requestedPage - 1)}>Página anterior</Link>
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
                      <Link aria-label={`Página ${item}`} to={filaHref(item)}>
                        {item}
                      </Link>
                    </li>
                  )
                )}
              </ol>
              {requestedPage < totalPages ? (
                <Link to={filaHref(requestedPage + 1)}>Próxima página</Link>
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
