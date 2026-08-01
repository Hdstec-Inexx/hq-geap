import {
  filaCuradoriaSchema,
  type FilaCuradoriaItem
} from '@hq-geap/contracts/curadoria';
import { Link } from 'react-router-dom';
import { getPerfil } from '../auth/session';
import { formatDuration, useAuthenticatedResource } from '../atendimentos/api';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export function FilaCuradoriaPage() {
  const state = useAuthenticatedResource('/curadoria?limit=100', filaCuradoriaSchema);
  const canWrite = getPerfil()?.role !== 'gestao';

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
        {state.status === 'ready' ? (
          <span className="queue-count">{state.data.length} pendente{state.data.length === 1 ? '' : 's'}</span>
        ) : null}
      </header>

      {state.status === 'loading' ? (
        <div className="curadoria-skeleton" aria-label="Carregando fila" />
      ) : null}
      {state.status === 'error' ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar a Fila de Curadoria.
        </p>
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <section className="curadoria-empty">
          <h2>Fila em dia</h2>
          <p>Não há Atendimentos aguardando conferência humana.</p>
        </section>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <section className="curadoria-list" aria-label="Atendimentos pendentes">
          {state.data.map((item: FilaCuradoriaItem) => (
            <article className="curadoria-row" key={item.id}>
              <div className="curadoria-row-main">
                <span>{item.agenteVozNome}</span>
                <Link to={`/curadoria/${item.id}`}>{item.conversationId}</Link>
                <small>{dateTime.format(new Date(item.concluidoEm))}</small>
              </div>
              <dl>
                <div><dt>Motivo</dt><dd>{item.motivoContato ?? 'Não informado'}</dd></div>
                <div><dt>Duração</dt><dd>{formatDuration(item.duracaoSegundos)}</dd></div>
                <div><dt>Nota IA</dt><dd>{item.notaIa.toLocaleString('pt-BR')}</dd></div>
              </dl>
              <Link className="review-link" to={`/curadoria/${item.id}`}>
                {canWrite ? 'Conferir' : 'Consultar'}
              </Link>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
