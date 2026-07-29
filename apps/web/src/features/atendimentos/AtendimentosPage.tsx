import {
  atendimentoListSchema,
  type AtendimentoSummary
} from '@hq-geap/contracts/atendimentos';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, getSession } from '../auth/session';

type PageState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; atendimentos: AtendimentoSummary[] };

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value))
    : 'Ainda em andamento';
}

function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return 'Não disponível';
  }
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

function formatCost(cost: number | null | undefined) {
  return cost === null || cost === undefined
    ? null
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(cost);
}

export function AtendimentosPage() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const session = getSession();
    const controller = new AbortController();
    if (!session) {
      setState({ status: 'error' });
      return () => controller.abort();
    }

    fetch(`${apiUrl}/atendimentos`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Atendimentos request failed with ${response.status}`);
        }
        return atendimentoListSchema.parse(await response.json());
      })
      .then((atendimentos) => setState({ status: 'ready', atendimentos }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, []);

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
      {state.status === 'ready' && state.atendimentos.length === 0 ? (
        <p className="atendimentos-state">Nenhum Atendimento recebido.</p>
      ) : null}
      {state.status === 'ready' && state.atendimentos.length > 0 ? (
        <div className="atendimentos-list">
          {state.atendimentos.map((atendimento) => {
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
        </div>
      ) : null}
    </main>
  );
}
