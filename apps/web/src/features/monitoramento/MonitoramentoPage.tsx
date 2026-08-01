import {
  monitoramentoConversasSchema
} from '@hq-geap/contracts/monitoramento';
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
    '/monitoramento/conversas',
    monitoramentoConversasSchema
  );

  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Operação / tempo real</p>
          <h1>Monitoramento ao Vivo</h1>
          <p className="summary">
            Observe conversas em andamento na ElevenLabs. Somente leitura — sem
            áudio e sem intervenção.
          </p>
        </div>
        <Link className="back-link" to="/">Voltar ao início</Link>
      </header>

      {state.status === 'loading' ? (
        <p className="atendimentos-state">Carregando conversas em andamento...</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível listar as conversas ao vivo. Verifique
          ELEVENLABS_API_KEY e a conectividade com a ElevenLabs.
        </p>
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <p className="atendimentos-state">Nenhuma conversa em andamento agora.</p>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <div className="atendimentos-list">
          {state.data.map((conversa) => (
            <article className="atendimento-row" key={conversa.conversationId}>
              <div className="atendimento-row-main">
                <span className="atendimento-status em_andamento">
                  Em andamento
                </span>
                <Link to={`/monitoramento/${conversa.conversationId}`}>
                  {conversa.conversationId}
                </Link>
                <span>
                  {conversa.agenteVozNome ?? conversa.agentId}
                </span>
              </div>
              <dl className="atendimento-row-data">
                <div>
                  <dt>Início</dt>
                  <dd>{formatDate(conversa.iniciadoEm)}</dd>
                </div>
                <div>
                  <dt>Ação</dt>
                  <dd>
                    <Link to={`/monitoramento/${conversa.conversationId}`}>
                      Observar
                    </Link>
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
