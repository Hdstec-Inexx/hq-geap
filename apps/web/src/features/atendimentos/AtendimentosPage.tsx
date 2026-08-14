import {
  atendimentoListSchema
} from '@hq-geap/contracts/atendimentos';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDuration, useAuthenticatedResource } from './api';
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
  const listQuery = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE)
  });
  if (detalhamentoQuery) {
    for (const [key, value] of new URLSearchParams(detalhamentoQuery)) {
      listQuery.set(key, value);
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
  const indicador = searchParams.get('indicador');
  const inicio = searchParams.get('inicio');
  const fim = searchParams.get('fim');
  const isDetalhamento = Boolean(indicador && inicio && fim);

  useEffect(() => {
    if (state.status === 'ready' && currentState && resolvedPage !== page) {
      navigate(paginationHref(searchParams, resolvedPage), { replace: true });
    }
  }, [currentState, navigate, page, resolvedPage, searchParams, state.status]);

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
              Período {inicio} → {fim}
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
            to={`/gestao/dashboard?inicio=${encodeURIComponent(inicio!)}&fim=${encodeURIComponent(fim!)}`}
          >
            Voltar ao Dashboard
          </Link>
        ) : (
          <Link className="back-link" to="/">Voltar ao início</Link>
        )}
      </header>

      {state.status === 'loading' || !currentState || pageOutOfRange ? (
        <p className="atendimentos-state">Carregando Atendimentos...</p>
      ) : null}
      {state.status === 'error' && currentState ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar os Atendimentos.
        </p>
      ) : null}
      {state.status === 'ready' && currentState && !pageOutOfRange && total === 0 ? (
        <p className="atendimentos-state">Nenhum Atendimento recebido.</p>
      ) : null}
      {state.status === 'ready' && currentState && !pageOutOfRange && items.length > 0 ? (
        <div className="atendimentos-list">
          {items.map((atendimento) => {
            const cost = formatCost(atendimento.custo);
            return (
              <article className="atendimento-row" key={atendimento.id}>
                <div className="atendimento-row-main">
                  <span className={`atendimento-status ${atendimento.status}`}>
                    {atendimento.status === 'concluido' ? 'Concluído' : 'Em andamento'}
                  </span>
                  <Link to={atendimentoHref(atendimento.id, searchParams)}>
                    {atendimento.motivoContato ?? 'Motivo não informado'}
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
