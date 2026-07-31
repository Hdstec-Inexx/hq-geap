import {
  avaliacaoCuradorResponseSchema,
  type AvaliacaoCuradorResumo
} from '@hq-geap/contracts/avaliacoes';
import { useAuthenticatedResource } from '../atendimentos/api';

const estadoLabels: Record<
  AvaliacaoCuradorResumo['checklist'][number]['estado'],
  string
> = {
  atendido: 'Atendido',
  nao_atendido: 'Não atendido',
  nao_se_aplica: 'Não se aplica'
};

export function AvaliacaoCuradorPanel({
  atendimentoId
}: {
  atendimentoId: string;
}) {
  const state = useAuthenticatedResource(
    `/atendimentos/${atendimentoId}/avaliacao-curador`,
    avaliacaoCuradorResponseSchema
  );

  if (state.status === 'loading') {
    return (
      <section className="avaliacao-panel avaliacao-state">
        Carregando Avaliação do Curador...
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="avaliacao-panel avaliacao-state">
        Não foi possível carregar a Avaliação do Curador.
      </section>
    );
  }
  if (state.data === null) {
    return (
      <section className="avaliacao-panel avaliacao-state">
        Avaliação do Curador ainda não disponível.
      </section>
    );
  }

  const avaliacao = state.data;
  return (
    <section className="avaliacao-panel" aria-labelledby="avaliacao-curador-heading">
      <header className="avaliacao-heading">
        <div>
          <p className="panel-label">{avaliacao.autor.nome}</p>
          <h2 id="avaliacao-curador-heading">Avaliação do Curador</h2>
        </div>
        <div className={`avaliacao-score ${avaliacao.aprovacao}`}>
          <strong>{avaliacao.nota.toLocaleString('pt-BR')}</strong>
          <span>
            {avaliacao.aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}
          </span>
        </div>
      </header>

      <div className="avaliacao-checklist">
        {avaliacao.checklist.map((criterio) => (
          <article
            className={`criterio-check criterio-${criterio.estado}`}
            key={criterio.chave}
          >
            <div>
              <h3>{criterio.nome}</h3>
              {criterio.critico ? (
                <span className="critical-label">Crítico</span>
              ) : null}
            </div>
            <p>
              {estadoLabels[criterio.estado]} ·{' '}
              {criterio.valor.toLocaleString('pt-BR')} pt
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
