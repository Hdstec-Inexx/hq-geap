import {
  atendimentoDetailSchema,
  type AtendimentoDetail
} from '@hq-geap/contracts/atendimentos';
import { Link, useParams } from 'react-router-dom';
import { AvaliacaoIaPanel } from '../avaliacoes/AvaliacaoIaPanel';
import { formatDuration, useAuthenticatedResource } from './api';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD'
});

export function AtendimentoPage() {
  const { atendimentoId } = useParams();
  const state = useAuthenticatedResource(
    `/atendimentos/${atendimentoId ?? ''}`,
    atendimentoDetailSchema
  );

  if (state.status !== 'ready') {
    return (
      <main className="atendimentos-page">
        <p className="atendimentos-state">
          {state.status === 'loading'
            ? 'Carregando Atendimento...'
            : 'Não foi possível carregar o Atendimento.'}
        </p>
      </main>
    );
  }

  const atendimento: AtendimentoDetail = state.data;
  return (
    <main className="atendimentos-page atendimento-detail">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">{atendimento.agenteVoz.nome} / {atendimento.status === 'concluido' ? 'Concluído' : 'Em andamento'}</p>
          <h1>Atendimento</h1>
          <p className="atendimento-id">{atendimento.conversationId}</p>
        </div>
        <Link className="back-link" to="/atendimentos">Voltar à lista</Link>
      </header>

      <section className="atendimento-facts" aria-label="Dados do Atendimento">
        <div><span>Motivo de Contato</span><strong>{atendimento.motivoContato ?? 'Não informado'}</strong></div>
        <div><span>Duração</span><strong>{formatDuration(atendimento.duracaoSegundos)}</strong></div>
        <div><span>Transferência</span><strong>{atendimento.houveTransferencia ? 'Realizada' : 'Não realizada'}</strong></div>
        {atendimento.custo !== undefined ? <div><span>Custo</span><strong>{atendimento.custo === null ? 'Não disponível' : currency.format(atendimento.custo)}</strong></div> : null}
      </section>

      {atendimento.status === 'concluido' ? (
        <AvaliacaoIaPanel atendimentoId={atendimento.id} />
      ) : null}

      <div className="atendimento-content">
        <section className="transcript-panel">
          <p className="panel-label">Transcrição</p>
          <div className="transcript-lines">
            {atendimento.transcricao.length === 0 ? <p>Transcrição ainda não disponível.</p> : atendimento.transcricao.map((entry, index) => (
              <article className={`transcript-line transcript-${entry.role}`} key={`${entry.time_in_call_secs}-${index}`}>
                <span>{entry.role === 'agent' ? atendimento.agenteVoz.nome : 'Cliente'} · {Math.floor(entry.time_in_call_secs / 60)}:{String(Math.floor(entry.time_in_call_secs % 60)).padStart(2, '0')}</span>
                <p>{entry.message}</p>
              </article>
            ))}
          </div>
        </section>
        <aside className="audio-panel">
          <p className="panel-label">Áudio</p>
          <h2>Ouça o contato completo</h2>
          {atendimento.audioUrl ? <audio controls preload="metadata" src={atendimento.audioUrl}>Seu navegador não suporta reprodução de áudio.</audio> : <p>Áudio ainda não disponível.</p>}
        </aside>
      </div>
    </main>
  );
}
