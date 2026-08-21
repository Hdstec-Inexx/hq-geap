import {
  atendimentoListSchema
} from '@hq-geap/contracts/atendimentos';
import { curadoresListSchema } from '@hq-geap/contracts/curadoria';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDuration, useAuthenticatedResource } from './api';
import { formatMotivoContato } from './motivo-combobox-logic';
import { MotivoCombobox } from './MotivoCombobox';
import { CriteriosMultiSelect } from './CriteriosMultiSelect';
import { parseCriteriaParam } from './criterios-filtro-logic';
import { detalhamentoQueryFromSearch } from '../dashboards/detalhamento';
import {
  compactPageItems,
  MAX_PAGE,
  PAGE_SIZE,
  pageFromSearch,
  resolvePage
} from '../pagination';

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value))
    : 'Ainda em andamento';
}

function formatCost(cost: number | null | undefined) {
  return cost === null || cost === undefined
    ? null
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'USD'
      }).format(cost);
}

function paginationHref(
  searchParams: URLSearchParams,
  page: number
): string {
  const next = new URLSearchParams(searchParams);
  if (page <= 1) {
    next.delete('page');
  } else {
    next.set('page', String(page));
  }
  const query = next.toString();
  return query ? `/atendimentos?${query}` : '/atendimentos';
}

function atendimentoHref(id: string, searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  return query ? `/atendimentos/${id}?${query}` : `/atendimentos/${id}`;
}

export function AtendimentosPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = pageFromSearch(searchParams);
  const detalhamentoQuery = detalhamentoQueryFromSearch(searchParams);

  const inicioParam = searchParams.get('inicio') ?? '';
  const fimParam = searchParams.get('fim') ?? '';
  const motivoParam = searchParams.get('motivo') ?? '';
  const curadoriaStatusParam = searchParams.get('curadoriaStatus') ?? '';
  const curadorIdParam = searchParams.get('curadorId') ?? '';
  const criteriosNaoAtendidosParam = parseCriteriaParam(
    searchParams,
    'criteriosNaoAtendidos'
  );
  const criteriosAtendidosParam = parseCriteriaParam(
    searchParams,
    'criteriosAtendidos'
  );
  const indicador = searchParams.get('indicador');
  const isDetalhamento = Boolean(indicador && inicioParam && fimParam);
  const hasActiveFilters = Boolean(
    !isDetalhamento &&
      (inicioParam ||
        fimParam ||
        motivoParam ||
        curadoriaStatusParam ||
        curadorIdParam ||
        criteriosNaoAtendidosParam.length > 0 ||
        criteriosAtendidosParam.length > 0)
  );

  const [draftInicio, setDraftInicio] = useState(inicioParam);
  const [draftFim, setDraftFim] = useState(fimParam);
  const [draftMotivo, setDraftMotivo] = useState(motivoParam);
  const [draftCuradoriaStatus, setDraftCuradoriaStatus] = useState(curadoriaStatusParam);
  const [draftCuradorId, setDraftCuradorId] = useState(curadorIdParam);
  const [draftCriteriosNaoAtendidos, setDraftCriteriosNaoAtendidos] =
    useState<string[]>(criteriosNaoAtendidosParam);
  const [draftCriteriosAtendidos, setDraftCriteriosAtendidos] =
    useState<string[]>(criteriosAtendidosParam);

  const curadoresState = useAuthenticatedResource('/curadores', curadoresListSchema);
  const curadores = curadoresState.status === 'ready' ? curadoresState.data : [];

  useEffect(() => {
    setDraftInicio(inicioParam);
    setDraftFim(fimParam);
    setDraftMotivo(motivoParam);
    setDraftCuradoriaStatus(curadoriaStatusParam);
    setDraftCuradorId(curadorIdParam);
    setDraftCriteriosNaoAtendidos(criteriosNaoAtendidosParam);
    setDraftCriteriosAtendidos(criteriosAtendidosParam);
  }, [
    inicioParam,
    fimParam,
    motivoParam,
    curadoriaStatusParam,
    curadorIdParam,
    searchParams
  ]);

  const listQuery = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE)
  });
  if (detalhamentoQuery) {
    for (const [key, value] of new URLSearchParams(detalhamentoQuery)) {
      listQuery.set(key, value);
    }
  } else {
    if (inicioParam) listQuery.set('inicio', inicioParam);
    if (fimParam) listQuery.set('fim', fimParam);
    if (motivoParam) listQuery.set('motivo', motivoParam);
    if (curadoriaStatusParam) listQuery.set('curadoriaStatus', curadoriaStatusParam);
    if (curadorIdParam) listQuery.set('curadorId', curadorIdParam);
    if (criteriosNaoAtendidosParam.length > 0) {
      listQuery.set('criteriosNaoAtendidos', criteriosNaoAtendidosParam.join(','));
    }
    if (criteriosAtendidosParam.length > 0) {
      listQuery.set('criteriosAtendidos', criteriosAtendidosParam.join(','));
    }
  }
  const requestPath = `/atendimentos?${listQuery.toString()}`;
  const state = useAuthenticatedResource(requestPath, atendimentoListSchema);
  const currentState = state.path === requestPath;
  const items = state.status === 'ready' && currentState ? state.data.items : [];
  const total = state.status === 'ready' && currentState ? state.data.total : 0;
  const resolvedPage = resolvePage(page, total, items.length);
  const pageOutOfRange =
    state.status === 'ready' && currentState && resolvedPage !== page;
  const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGE);

  useEffect(() => {
    if (state.status === 'ready' && currentState && resolvedPage !== page) {
      navigate(paginationHref(searchParams, resolvedPage), { replace: true });
    }
  }, [currentState, navigate, page, resolvedPage, searchParams, state.status]);

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
    if (draftCuradoriaStatus) next.set('curadoriaStatus', draftCuradoriaStatus);
    if (draftCuradorId) next.set('curadorId', draftCuradorId);
    if (draftCriteriosNaoAtendidos.length > 0) {
      next.set('criteriosNaoAtendidos', draftCriteriosNaoAtendidos.join(','));
    }
    if (draftCriteriosAtendidos.length > 0) {
      next.set('criteriosAtendidos', draftCriteriosAtendidos.join(','));
    }
    navigate(paginationHref(next, 1));
  }

  function handleClearFilters() {
    setDraftInicio('');
    setDraftFim('');
    setDraftMotivo('');
    setDraftCuradoriaStatus('');
    setDraftCuradorId('');
    setDraftCriteriosNaoAtendidos([]);
    setDraftCriteriosAtendidos([]);
    navigate('/atendimentos');
  }

  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">
            {isDetalhamento
              ? 'Gestão / Detalhamento do Indicador'
              : 'Operação / histórico'}
          </p>
          <h1>Atendimentos</h1>
          {isDetalhamento ? (
            <p className="atendimentos-detalhamento-meta">
              Período {inicioParam} → {fimParam}
              {' · '}
              {indicador}
              {searchParams.get('motivo')
                ? ` · ${searchParams.get('motivo')}`
                : ''}
            </p>
          ) : null}
        </div>
        {isDetalhamento ? (
          <Link
            className="back-link"
            to={`/gestao/dashboard?inicio=${encodeURIComponent(inicioParam)}&fim=${encodeURIComponent(fimParam)}`}
          >
            Voltar ao Dashboard
          </Link>
        ) : (
          <Link className="back-link" to="/">Voltar ao início</Link>
        )}
      </header>

      {!isDetalhamento ? (
        <form className="atendimentos-filters" onSubmit={handleFilterSubmit}>
          <div className="atendimentos-filters-fields">
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
            <span aria-hidden="true" className="atendimentos-filters-arrow">
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
                id="atendimentos-motivo-filtro"
                name="motivo"
                onChange={setDraftMotivo}
                placeholder="Todos os motivos"
                value={draftMotivo}
              />
            </label>
            <label>
              Critérios Não Atendidos
              <CriteriosMultiSelect
                id="atendimentos-criterios-nao-atendidos-filtro"
                name="criteriosNaoAtendidos"
                onChange={setDraftCriteriosNaoAtendidos}
                placeholder="Todos os critérios"
                value={draftCriteriosNaoAtendidos}
              />
            </label>
            <label>
              Critérios Atendidos
              <CriteriosMultiSelect
                id="atendimentos-criterios-atendidos-filtro"
                name="criteriosAtendidos"
                onChange={setDraftCriteriosAtendidos}
                placeholder="Todos os critérios"
                value={draftCriteriosAtendidos}
              />
            </label>
            <label>
              Status da Curadoria
              <select
                id="atendimentos-curadoria-status-filtro"
                name="curadoriaStatus"
                onChange={(event) => setDraftCuradoriaStatus(event.target.value)}
                value={draftCuradoriaStatus}
              >
                <option value="">Todos</option>
                <option value="realizada">Realizada</option>
                <option value="pendente">Pendente</option>
              </select>
            </label>
            <label>
              Curador
              <select
                id="atendimentos-curador-filtro"
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
          </div>
          <div className="atendimentos-filters-actions">
            <button className="primary-action" type="submit">
              Filtrar
            </button>
            {hasActiveFilters ? (
              <button
                className="atendimentos-filter-clear"
                onClick={handleClearFilters}
                type="button"
              >
                Limpar filtros
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {state.status === 'loading' || !currentState || pageOutOfRange ? (
        <p className="atendimentos-state">Carregando Atendimentos...</p>
      ) : null}
      {state.status === 'error' && currentState ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar os Atendimentos.
        </p>
      ) : null}
      {state.status === 'ready' && currentState && !pageOutOfRange && total === 0 ? (
        <p className="atendimentos-state">
          {hasActiveFilters
            ? 'Nenhum Atendimento encontrado para os filtros selecionados.'
            : 'Nenhum Atendimento recebido.'}
        </p>
      ) : null}
      {state.status === 'ready' && currentState && !pageOutOfRange && items.length > 0 ? (
        <div className="atendimentos-list">
          {items.map((atendimento) => {
            const cost = formatCost(atendimento.custo);
            return (
              <article className="atendimento-row" key={atendimento.id}>
                <div className="atendimento-row-main">
                  <div className="atendimento-badges">
                    <span className={`atendimento-status ${atendimento.status}`}>
                      {atendimento.status === 'concluido' ? 'Concluído' : 'Em andamento'}
                    </span>
                    {atendimento.curadoria?.realizada ? (
                      <span className="atendimento-curadoria-badge realizada">
                        Curadoria: {atendimento.curadoria.curadorNome ?? 'Realizada'}
                      </span>
                    ) : atendimento.status === 'concluido' ? (
                      <span className="atendimento-curadoria-badge pendente">
                        Curadoria pendente
                      </span>
                    ) : null}
                  </div>
                  <Link to={atendimentoHref(atendimento.id, searchParams)}>
                    {formatMotivoContato(atendimento.motivoContato)}
                  </Link>
                  <span>{atendimento.agenteVoz.nome}</span>
                </div>
                <dl className="atendimento-row-data">
                  <div><dt>Conclusão</dt><dd>{formatDate(atendimento.concluidoEm)}</dd></div>
                  <div><dt>Duração</dt><dd>{formatDuration(atendimento.duracaoSegundos)}</dd></div>
                  <div><dt>Transferência</dt><dd>{atendimento.houveTransferencia ? 'Sim' : 'Não'}</dd></div>
                  {cost ? <div><dt>Custo</dt><dd>{cost}</dd></div> : null}
                </dl>
              </article>
            );
          })}
          {totalPages > 1 ? <nav className="atendimentos-pagination" aria-label="Paginação dos Atendimentos">
            {page > 1 ? (
              <Link to={paginationHref(searchParams, page - 1)}>Página anterior</Link>
            ) : (
              <span />
            )}
            <ol>
              {compactPageItems(page, totalPages).map((item, index) =>
                item === 'ellipsis' ? (
                  <li key={`ellipsis-${index}`}>
                    <span aria-hidden="true">…</span>
                  </li>
                ) : item === page ? (
                  <li key={item}>
                    <span aria-current="page" aria-label={`Página ${item}`}>
                      {item}
                    </span>
                  </li>
                ) : (
                  <li key={item}>
                    <Link
                      aria-label={`Página ${item}`}
                      to={paginationHref(searchParams, item)}
                    >
                      {item}
                    </Link>
                  </li>
                )
              )}
            </ol>
            {page < totalPages ? (
              <Link to={paginationHref(searchParams, page + 1)}>Próxima página</Link>
            ) : (
              <span />
            )}
          </nav> : null}
        </div>
      ) : null}
    </main>
  );
}
