import {
  curadoresListSchema,
  curadoriasRealizadasPageSchema,
  type CuradoriaRealizadaItem
} from '@hq-geap/contracts/curadoria';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { usePerfil } from '../auth/perfil-context';
import { formatDuration, useAuthenticatedResource } from '../atendimentos/api';
import { formatMotivoContato } from '../atendimentos/motivo-combobox-logic';
import { MotivoCombobox } from '../atendimentos/MotivoCombobox';
import { CriteriosMultiSelect } from '../atendimentos/CriteriosMultiSelect';
import { parseCriteriaParam } from '../atendimentos/criterios-filtro-logic';
import {
  compactPageItems,
  curadoriasRealizadasHref,
  FILA_PAGE_SIZE,
  MAX_FILA_PAGE,
  pageFromSearch,
  resolveFilaPage,
  reviewHref
} from './pagination';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export function CuradoriasRealizadasPage() {
  const location = useLocation();
  const perfil = usePerfil();
  const role = perfil?.role;
  const isMinhas = location.pathname.startsWith('/minhas-curadorias') || role === 'curador';
  const basePath = isMinhas ? '/minhas-curadorias' : '/curadorias-realizadas';

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedPage = pageFromSearch(searchParams);

  const inicioParam = searchParams.get('inicio') ?? '';
  const fimParam = searchParams.get('fim') ?? '';
  const motivoParam = searchParams.get('motivo') ?? '';
  const curadorIdParam = searchParams.get('curadorId') ?? '';
  const criteriosNaoAtendidosParam = parseCriteriaParam(
    searchParams,
    'criteriosNaoAtendidos'
  );
  const criteriosAtendidosParam = parseCriteriaParam(
    searchParams,
    'criteriosAtendidos'
  );
  const [draftInicio, setDraftInicio] = useState(inicioParam);
  const [draftFim, setDraftFim] = useState(fimParam);
  const [draftMotivo, setDraftMotivo] = useState(motivoParam);
  const [draftCuradorId, setDraftCuradorId] = useState(curadorIdParam);
  const [draftCriteriosNaoAtendidos, setDraftCriteriosNaoAtendidos] =
    useState<string[]>(criteriosNaoAtendidosParam);
  const [draftCriteriosAtendidos, setDraftCriteriosAtendidos] =
    useState<string[]>(criteriosAtendidosParam);

  const hasDraftFilters = Boolean(
    draftInicio ||
      draftFim ||
      draftMotivo ||
      (!isMinhas && draftCuradorId) ||
      draftCriteriosNaoAtendidos.length > 0 ||
      draftCriteriosAtendidos.length > 0
  );

  const hasActiveFilters = Boolean(
    inicioParam ||
      fimParam ||
      motivoParam ||
      (!isMinhas && curadorIdParam) ||
      criteriosNaoAtendidosParam.length > 0 ||
      criteriosAtendidosParam.length > 0 ||
      hasDraftFilters
  );

  const curadoresState = useAuthenticatedResource('/curadores', curadoresListSchema);
  const curadores = curadoresState.status === 'ready' ? curadoresState.data : [];

  useEffect(() => {
    setDraftInicio(inicioParam);
    setDraftFim(fimParam);
    setDraftMotivo(motivoParam);
    setDraftCuradorId(curadorIdParam);
    setDraftCriteriosNaoAtendidos(criteriosNaoAtendidosParam);
    setDraftCriteriosAtendidos(criteriosAtendidosParam);
  }, [
    inicioParam,
    fimParam,
    motivoParam,
    curadorIdParam,
    searchParams
  ]);

  const query = new URLSearchParams({
    limit: String(FILA_PAGE_SIZE),
    offset: String((requestedPage - 1) * FILA_PAGE_SIZE)
  });
  if (inicioParam) query.set('inicio', inicioParam);
  if (fimParam) query.set('fim', fimParam);
  if (motivoParam) query.set('motivo', motivoParam);
  if (!isMinhas && curadorIdParam) query.set('curadorId', curadorIdParam);
  if (criteriosNaoAtendidosParam.length > 0) {
    query.set('criteriosNaoAtendidos', criteriosNaoAtendidosParam.join(','));
  }
  if (criteriosAtendidosParam.length > 0) {
    query.set('criteriosAtendidos', criteriosAtendidosParam.join(','));
  }

  const requestPath = `/curadorias-realizadas?${query.toString()}`;
  const state = useAuthenticatedResource(requestPath, curadoriasRealizadasPageSchema);
  const currentState = state.path === requestPath;
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
      navigate(curadoriasRealizadasHref(basePath, searchParams, resolvedPage), { replace: true });
    }
  }, [basePath, currentState, navigate, requestedPage, resolvedPage, searchParams, state.status]);

  function handleFilterSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (draftInicio) {
      next.set('inicio', draftInicio);
      if (draftFim && draftFim >= draftInicio) {
        next.set('fim', draftFim);
      }
    }
    if (draftMotivo.trim()) next.set('motivo', draftMotivo.trim());
    if (!isMinhas && draftCuradorId) next.set('curadorId', draftCuradorId);
    if (draftCriteriosNaoAtendidos.length > 0) {
      next.set('criteriosNaoAtendidos', draftCriteriosNaoAtendidos.join(','));
    }
    if (draftCriteriosAtendidos.length > 0) {
      next.set('criteriosAtendidos', draftCriteriosAtendidos.join(','));
    }
    navigate(curadoriasRealizadasHref(basePath, next, 1));
  }

  function handleClearFilters() {
    setDraftInicio('');
    setDraftFim('');
    setDraftMotivo('');
    setDraftCuradorId('');
    setDraftCriteriosNaoAtendidos([]);
    setDraftCriteriosAtendidos([]);
    navigate(basePath);
  }

  const pageTitle = isMinhas ? 'Minhas Curadorias' : 'Curadorias Realizadas';
  const pageIntro = isMinhas
    ? 'Histórico de atendimentos conferidos por você.'
    : 'Histórico de atendimentos conferidos pelos curadores.';

  return (
    <main className="atendimentos-page curadoria-page">
      <header className="atendimentos-heading curadoria-heading">
        <div>
          <p className="eyebrow">Conferência humana</p>
          <h1>{pageTitle}</h1>
          <p className="curadoria-intro">{pageIntro}</p>
          <Link className="back-link" to="/">
            Voltar ao início
          </Link>
        </div>
        {paginaPronta && total > 0 ? (
          <span className="queue-count">
            {items.length} realizada{items.length === 1 ? '' : 's'}
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
            Motivo de Contato
            <MotivoCombobox
              id="curadorias-realizadas-motivo-filtro"
              name="motivo"
              onChange={setDraftMotivo}
              placeholder="Todos os motivos"
              value={draftMotivo}
            />
          </label>
          <label>
            Critérios Não Atendidos
            <CriteriosMultiSelect
              id="curadorias-criterios-nao-atendidos-filtro"
              name="criteriosNaoAtendidos"
              onChange={setDraftCriteriosNaoAtendidos}
              placeholder="Todos os critérios"
              value={draftCriteriosNaoAtendidos}
            />
          </label>
          <label>
            Critérios Atendidos
            <CriteriosMultiSelect
              id="curadorias-criterios-atendidos-filtro"
              name="criteriosAtendidos"
              onChange={setDraftCriteriosAtendidos}
              placeholder="Todos os critérios"
              value={draftCriteriosAtendidos}
            />
          </label>
          {!isMinhas ? (
            <label>
              Curador
              <select
                id="curadorias-realizadas-curador-filtro"
                name="curadorId"
                onChange={(event) => setDraftCuradorId(event.target.value)}
                value={draftCuradorId}
              >
                <option value="">Todos os curadores</option>
                {curadores.map((curador) => (
                  <option key={curador.id} value={curador.id}>
                    {curador.nome}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
        <div aria-label="Carregando curadorias realizadas" className="curadoria-skeleton" />
      ) : null}
      {state.status === 'error' && currentState ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar as Curadorias Realizadas.
        </p>
      ) : null}
      {paginaPronta && total === 0 ? (
        <section className="curadoria-empty">
          <h2>{hasActiveFilters ? 'Nenhum Atendimento encontrado' : 'Nenhuma curadoria realizada'}</h2>
          <p>
            {hasActiveFilters
              ? 'Não há Atendimentos conferidos para os filtros selecionados.'
              : isMinhas
                ? 'Você ainda não realizou nenhuma conferência de Atendimento.'
                : 'Não há Atendimentos conferidos por curadores.'}
          </p>
        </section>
      ) : null}
      {paginaPronta && items.length > 0 ? (
        <section aria-label="Curadorias realizadas" className="curadoria-list">
          {items.map((item: CuradoriaRealizadaItem) => (
            <article className="curadoria-row" key={item.id}>
              <div className="curadoria-row-main">
                <span>{item.agenteVozNome}</span>
                <Link to={reviewHref(item.id, searchParams, basePath)}>
                  {item.conversationId}
                </Link>
                <small>{dateTime.format(new Date(item.realizadaEm))}</small>
              </div>
              <dl>
                <div><dt>Motivo</dt><dd>{formatMotivoContato(item.motivoContato)}</dd></div>
                <div><dt>Duração</dt><dd>{formatDuration(item.duracaoSegundos)}</dd></div>
                <div><dt>Nota IA</dt><dd>{item.notaIa.toLocaleString('pt-BR')}</dd></div>
                <div><dt>Nota Curador</dt><dd>{item.notaCurador.toLocaleString('pt-BR')}</dd></div>
                {!isMinhas && item.curadorNome ? (
                  <div><dt>Curador</dt><dd>{item.curadorNome}</dd></div>
                ) : null}
              </dl>
              <Link className="review-link" to={reviewHref(item.id, searchParams, basePath)}>
                Consultar
              </Link>
            </article>
          ))}
          {totalPages > 1 ? (
            <nav
              aria-label={
                isMinhas
                  ? 'Paginação de Minhas Curadorias'
                  : 'Paginação de Curadorias Realizadas'
              }
              className="curadoria-pagination"
            >
              {requestedPage > 1 ? (
                <Link to={curadoriasRealizadasHref(basePath, searchParams, requestedPage - 1)}>
                  Página anterior
                </Link>
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
                      <Link
                        aria-label={`Página ${item}`}
                        to={curadoriasRealizadasHref(basePath, searchParams, item)}
                      >
                        {item}
                      </Link>
                    </li>
                  )
                )}
              </ol>
              {requestedPage < totalPages ? (
                <Link to={curadoriasRealizadasHref(basePath, searchParams, requestedPage + 1)}>
                  Próxima página
                </Link>
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
