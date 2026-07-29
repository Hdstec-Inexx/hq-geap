import {
  atendimentoDetailSchema,
  type AtendimentoDetail
} from '@hq-geap/contracts/atendimentos';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiUrl, getSession } from '../auth/session';

type PageState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; atendimento: AtendimentoDetail };

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

export function AtendimentoPage() {
  const { atendimentoId } = useParams();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const session = getSession();
    const controller = new AbortController();
    if (!session || !atendimentoId) {
      setState({ status: 'error' });
      return () => controller.abort();
    }

    fetch(`${apiUrl}/atendimentos/${atendimentoId}`, {
      headers: { authorization: `Bearer ${session.token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Atendimento request failed with ${response.status}`);
        }
        return atendimentoDetailSchema.parse(await response.json());
      })
      .then((atendimento) => setState({ status: 'ready', atendimento }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, [atendimentoId]);

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

  const { atendimento } = state;
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
        <div><span>Duração</span><strong>{atendimento.duracaoSegundos === null ? 'Não disponível' : `${Math.floor(atendimento.duracaoSegundos / 60)}min ${atendimento.duracaoSegundos % 60}s`}</strong></div>
        <div><span>Transferência</span><strong>{atendimento.houveTransferencia ? 'Realizada' : 'Não realizada'}</strong></div>
        {atendimento.custo !== undefined ? <div><span>Custo</span><strong>{atendimento.custo === null ? 'Não disponível' : currency.format(atendimento.custo)}</strong></div> : null}
      </section>

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
