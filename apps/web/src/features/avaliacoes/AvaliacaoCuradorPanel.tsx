import {
  avaliacaoCuradorResponseSchema,
  type AvaliacaoCuradorResumo,
  type EstadoCriterio
} from '@hq-geap/contracts/avaliacoes';
import type { AvaliacaoCurador } from '@hq-geap/contracts/curadoria';
import { useAuthenticatedResource } from '../atendimentos/api';
import { CriterionTooltip } from './CriterionTooltip';

export const estadoLabels: Record<EstadoCriterio, string> = {
  atendido: 'Atendido',
  nao_atendido: 'Não atendido',
  nao_se_aplica: 'Não se aplica'
};

export const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export type AvaliacaoCuradorPanelProps = {
  atendimentoId?: string;
  avaliacao?: AvaliacaoCuradorResumo | AvaliacaoCurador | null;
  emptyMessage?: string;
};

export function AvaliacaoCuradorCard({
  avaliacao
}: {
  avaliacao: AvaliacaoCuradorResumo | AvaliacaoCurador;
}) {
  return (
    <section className="avaliacao-panel" aria-labelledby="avaliacao-curador-heading">
      <header className="avaliacao-heading">
        <div>
          <p className="panel-label">
            {avaliacao.autor.nome} · {dateTime.format(new Date(avaliacao.criadoEm))}
          </p>
          <h2 id="avaliacao-curador-heading">Avaliação do Curador</h2>
        </div>
        <div className={`avaliacao-score ${avaliacao.aprovacao}`}>
          <strong>{avaliacao.nota.toLocaleString('pt-BR')}</strong>
          <span>
            {avaliacao.aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}
          </span>
        </div>
      </header>

      <p className="avaliacao-curador-nota-ia">
        Nota da Avaliação da IA:{' '}
        {avaliacao.notaAvaliacaoIa.toLocaleString('pt-BR')}
      </p>

      {avaliacao.resumoAtendimento || avaliacao.falhasIdentificadas.length > 0 ? (
        <div className="avaliacao-curador-top-scroll">
          {avaliacao.resumoAtendimento ? <p>{avaliacao.resumoAtendimento}</p> : null}
          {avaliacao.falhasIdentificadas.length > 0 ? (
            <ul>
              {avaliacao.falhasIdentificadas.map((falha) => (
                <li key={falha}>{falha}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="avaliacao-checklist">
        {avaliacao.checklist.map((criterio) => (
          <article
            className={`criterio-check criterio-${criterio.estado}`}
            key={criterio.chave}
          >
            <div>
              <h3>
                <CriterionTooltip
                  chave={criterio.chave}
                  nome={criterio.nome}
                  descricao={criterio.descricao}
                />
              </h3>
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

      {avaliacao.comentario ? (
        <div className="avaliacao-curador-comentario">
          <p className="panel-label">Comentário da revisão</p>
          <p className="avaliacao-comentario-scroll">{avaliacao.comentario}</p>
        </div>
      ) : null}
    </section>
  );
}

function AvaliacaoCuradorPanelFetcher({
  atendimentoId,
  emptyMessage
}: {
  atendimentoId: string;
  emptyMessage?: string;
}) {
  const state = useAuthenticatedResource(
    `/atendimentos/${atendimentoId}/avaliacao-curador`,
    avaliacaoCuradorResponseSchema
  );

  if (state.status === 'error') {
    return (
      <section className="avaliacao-panel avaliacao-state">
        Não foi possível carregar a Avaliação do Curador.
      </section>
    );
  }

  if (state.status !== 'ready' || state.data === null) {
    if (state.status === 'ready' && state.data === null && emptyMessage) {
      return (
        <section className="avaliacao-panel avaliacao-state">
          {emptyMessage}
        </section>
      );
    }
    return null;
  }

  return <AvaliacaoCuradorCard avaliacao={state.data} />;
}

export function AvaliacaoCuradorPanel({
  atendimentoId,
  avaliacao,
  emptyMessage
}: AvaliacaoCuradorPanelProps) {
  if (avaliacao !== undefined) {
    if (!avaliacao) {
      if (emptyMessage) {
        return (
          <section className="avaliacao-panel avaliacao-state">
            {emptyMessage}
          </section>
        );
      }
      return null;
    }
    return <AvaliacaoCuradorCard avaliacao={avaliacao} />;
  }

  if (!atendimentoId) {
    return null;
  }

  return (
    <AvaliacaoCuradorPanelFetcher
      atendimentoId={atendimentoId}
      emptyMessage={emptyMessage}
    />
  );
}
