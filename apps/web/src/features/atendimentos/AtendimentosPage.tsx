import {
  atendimentoListSchema
} from '@hq-geap/contracts/atendimentos';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDuration, useAuthenticatedResource } from './api';

const pageSize = 50;
const maximumPage = 201;

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

export function AtendimentosPage() {
  const [searchParams] = useSearchParams();
  const page = Math.min(
    maximumPage,
    Math.max(1, Math.floor(Number(searchParams.get('page')) || 1))
  );
  const state = useAuthenticatedResource(
    `/atendimentos?limit=${pageSize}&offset=${(page - 1) * pageSize}`,
    atendimentoListSchema
  );

  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Operação / histórico</p>
          <h1>Atendimentos</h1>
        </div>
        <Link className="back-link" to="/">Voltar ao início</Link>
      </header>

      {state.status === 'loading' ? (
        <p className="atendimentos-state">Carregando Atendimentos...</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar os Atendimentos.
        </p>
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <p className="atendimentos-state">Nenhum Atendimento recebido.</p>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <div className="atendimentos-list">
          {state.data.map((atendimento) => {
            const cost = formatCost(atendimento.custo);
            return (
              <article className="atendimento-row" key={atendimento.id}>
                <div className="atendimento-row-main">
                  <span className={`atendimento-status ${atendimento.status}`}>
                    {atendimento.status === 'concluido' ? 'Concluído' : 'Em andamento'}
                  </span>
                  <Link to={`/atendimentos/${atendimento.id}`}>
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
          <nav className="atendimentos-pagination" aria-label="Paginação">
            {page > 1 ? <Link to={`?page=${page - 1}`}>Página anterior</Link> : <span />}
            {state.data.length === pageSize && page < maximumPage ? <Link to={`?page=${page + 1}`}>Próxima página</Link> : null}
          </nav>
        </div>
      ) : null}
    </main>
  );
}
