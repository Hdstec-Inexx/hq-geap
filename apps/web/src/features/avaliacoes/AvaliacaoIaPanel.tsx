import { avaliacaoIaResponseSchema } from '@hq-geap/contracts/avaliacoes';
import { useAuthenticatedResource } from '../atendimentos/api';

export function AvaliacaoIaPanel({ atendimentoId }: { atendimentoId: string }) {
  const state = useAuthenticatedResource(
    `/atendimentos/${atendimentoId}/avaliacao-ia`,
    avaliacaoIaResponseSchema
  );

  if (state.status === 'loading') {
    return <section className="avaliacao-panel avaliacao-state">Carregando Avaliação da IA...</section>;
  }
  if (state.status === 'error') {
    return <section className="avaliacao-panel avaliacao-state">Não foi possível carregar a Avaliação da IA.</section>;
  }
  if (state.data === null) {
    return <section className="avaliacao-panel avaliacao-state">Avaliação da IA ainda não disponível.</section>;
  }

  const avaliacao = state.data;
  return (
    <section className="avaliacao-panel" aria-labelledby="avaliacao-ia-heading">
      <header className="avaliacao-heading">
        <div>
          <p className="panel-label">Prompt v{avaliacao.promptVersao}</p>
          <h2 id="avaliacao-ia-heading">Avaliação da IA</h2>
        </div>
        <div className={`avaliacao-score ${avaliacao.aprovacao}`}>
          <strong>{avaliacao.nota.toLocaleString('pt-BR')}</strong>
          <span>{avaliacao.aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}</span>
        </div>
      </header>

      <div className="avaliacao-notes">
        <div>
          <p className="panel-label">Claims da LLM (não canônicos)</p>
          <p>
            Nota claim {avaliacao.notaQualidade.toLocaleString('pt-BR')} ·{' '}
            {avaliacao.atendimentoAprovado
              ? 'Aprovação claim: sim'
              : 'Aprovação claim: não'}
          </p>
        </div>
      </div>

      <div className="avaliacao-checklist">
        {avaliacao.criterios.map((criterio) => (
          <article
            className={`criterio-check criterio-${criterio.atendido ? 'atendido' : 'nao_atendido'}`}
            key={criterio.chave}
          >
            <div>
              <h3>{criterio.nome}</h3>
              {criterio.critico ? <span className="critical-label">Crítico</span> : null}
            </div>
            <p>
              {criterio.atendido ? 'Atendido' : 'Não atendido'} ·{' '}
              {criterio.valor.toLocaleString('pt-BR')} pt
            </p>
          </article>
        ))}
      </div>

      <div className="avaliacao-notes">
        <div>
          <p className="panel-label">Resumo</p>
          <p>{avaliacao.resumoAtendimento ?? 'Resumo não informado.'}</p>
        </div>
        <div>
          <p className="panel-label">Falhas identificadas</p>
          {avaliacao.falhasIdentificadas.length === 0 ? (
            <p>Nenhuma falha identificada.</p>
          ) : (
            <ul>{avaliacao.falhasIdentificadas.map((falha) => <li key={falha}>{falha}</li>)}</ul>
          )}
        </div>
      </div>
    </section>
  );
}
