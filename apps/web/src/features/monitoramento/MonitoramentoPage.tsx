import {
  atendimentoListSchema
} from '@hq-geap/contracts/atendimentos';
import { Link } from 'react-router-dom';
import { useAuthenticatedResource } from '../atendimentos/api';

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value))
    : 'Início não informado';
}

export function MonitoramentoPage() {
  const state = useAuthenticatedResource(
    '/atendimentos?status=em_andamento&limit=50&offset=0',
    atendimentoListSchema
  );

  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Operação / tempo real</p>
          <h1>Monitoramento ao Vivo</h1>
          <p className="summary">
            Observe Atendimentos em andamento. Somente leitura — sem áudio e sem
            intervenção.
          </p>
        </div>
        <Link className="back-link" to="/">Voltar ao início</Link>
      </header>

      {state.status === 'loading' ? (
        <p className="atendimentos-state">Carregando Atendimentos em andamento...</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar os Atendimentos em andamento.
        </p>
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <p className="atendimentos-state">Nenhum Atendimento em andamento agora.</p>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <div className="atendimentos-list">
          {state.data.map((atendimento) => (
            <article className="atendimento-row" key={atendimento.id}>
              <div className="atendimento-row-main">
                <span className={`atendimento-status ${atendimento.status}`}>
                  Em andamento
                </span>
                <Link to={`/monitoramento/${atendimento.id}`}>
                  {atendimento.motivoContato ?? 'Motivo não informado'}
                </Link>
                <span>{atendimento.agenteVoz.nome}</span>
              </div>
              <dl className="atendimento-row-data">
                <div>
                  <dt>Início</dt>
                  <dd>{formatDate(atendimento.iniciadoEm)}</dd>
                </div>
                <div>
                  <dt>Ação</dt>
                  <dd>
                    <Link to={`/monitoramento/${atendimento.id}`}>Observar</Link>
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}
