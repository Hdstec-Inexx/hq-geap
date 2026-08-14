import {
  avaliacaoCuradorSchema,
  curadoriaDetailSchema,
  type CuradoriaDetail
} from '@hq-geap/contracts/curadoria';
import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiUrl, getSession } from '../auth/session';
import { canWriteAsCurador, usePerfil } from '../auth/perfil-context';
import { formatDuration, useAuthenticatedResource } from '../atendimentos/api';
import { ComentariosPanel } from '../comentarios/ComentariosPanel';

const stateLabels: Record<EstadoCriterio, string> = {
  atendido: 'Atendido',
  nao_atendido: 'Não atendido',
  nao_se_aplica: 'Não se aplica'
};

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

function ReviewForm({
  detail,
  onSaved
}: {
  detail: CuradoriaDetail;
  onSaved: () => void;
}) {
  const [estados, setEstados] = useState<Record<string, EstadoCriterio>>(() =>
    Object.fromEntries(
      detail.avaliacaoIa.checklist.map(({ chave, estado }) => [chave, estado])
    )
  );
  const [notaAvaliacaoIa, setNotaAvaliacaoIa] = useState(() =>
    String(detail.avaliacaoIa.nota)
  );
  const [falhasIdentificadas, setFalhasIdentificadas] = useState(
    detail.avaliacaoIa.falhasIdentificadas.join('\n')
  );
  const [resumoAtendimento, setResumoAtendimento] = useState(
    detail.avaliacaoIa.resumoAtendimento ?? ''
  );
  const [comentario, setComentario] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const ferramentasNaoAtendidas = estados.uso_correto_ferramentas === 'nao_atendido';
  const checklist = detail.avaliacaoIa.checklist.map((criterio) => {
    let estado = estados[criterio.chave] ?? criterio.estado;
    if (
      ferramentasNaoAtendidas &&
      criterio.chave === 'resolveu_solicitacao' &&
      estado !== 'nao_atendido'
    ) {
      estado = 'nao_atendido';
    }
    return { ...criterio, estado };
  });
  const nota = checklist.reduce(
    (total, criterio) => total + (criterio.estado === 'nao_atendido' ? 0 : criterio.valor),
    0
  );
  const falhaCritica = checklist.some(
    (criterio) => criterio.critico && criterio.estado === 'nao_atendido'
  );
  const aprovacao = nota >= 7 && !falhaCritica ? 'aprovado' : 'reprovado';
  const notaAvaliacaoIaNumero = Number(notaAvaliacaoIa);
  const notaAvaliacaoIaValida =
    Number.isFinite(notaAvaliacaoIaNumero) &&
    notaAvaliacaoIaNumero >= 0 &&
    notaAvaliacaoIaNumero <= 10;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const session = getSession();
    if (!session || !notaAvaliacaoIaValida) return;
    setSubmitState('saving');
    try {
      const response = await fetch(
        `${apiUrl}/curadoria/${detail.atendimento.id}/avaliacoes`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            checklist: checklist.map(({ chave, estado }) => ({ chave, estado })),
            notaAvaliacaoIa: notaAvaliacaoIaNumero,
            falhasIdentificadas: falhasIdentificadas
              .split('\n')
              .map((linha) => linha.trim())
              .filter(Boolean),
            resumoAtendimento: resumoAtendimento.trim() || null,
            comentario: comentario.trim() || null
          })
        }
      );
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      avaliacaoCuradorSchema.parse(await response.json());
      setSubmitState('saved');
      onSaved();
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <form className="review-form" onSubmit={save}>
      <div className="review-form-heading">
        <div>
          <p className="panel-label">Checklist do Curador</p>
          <h2>Conferência humana</h2>
          <p>Os estados começam iguais aos da IA. Confirme ou corrija cada Critério.</p>
        </div>
        <div className={`review-score ${aprovacao}`} aria-live="polite">
          <strong>{nota.toLocaleString('pt-BR')}</strong>
          <span>{aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}</span>
        </div>
      </div>

      <div className="review-checklist">
        {checklist.map((criterio) => (
          <fieldset key={criterio.chave}>
            <legend>
              {criterio.nome}
              {criterio.critico ? <span>Crítico</span> : null}
            </legend>
            <div className="criterion-options">
              {(['atendido', 'nao_atendido', 'nao_se_aplica'] as const).map((estado) =>
                estado === 'nao_se_aplica' && !criterio.condicional ? null : (
                  <label key={estado}>
                    <input
                      checked={criterio.estado === estado}
                      disabled={
                        criterio.chave === 'resolveu_solicitacao' &&
                        ferramentasNaoAtendidas &&
                        estado !== 'nao_atendido'
                      }
                      name={criterio.chave}
                      onChange={() =>
                        setEstados((current) => {
                          const next = { ...current, [criterio.chave]: estado };
                          if (
                            criterio.chave === 'uso_correto_ferramentas' &&
                            estado === 'nao_atendido'
                          ) {
                            next.resolveu_solicitacao = 'nao_atendido';
                          }
                          return next;
                        })
                      }
                      type="radio"
                      value={estado}
                    />
                    <span>{stateLabels[estado]}</span>
                  </label>
                )
              )}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="review-mirror-fields">
        <label>
          Nota da Avaliação da IA
          <input
            inputMode="decimal"
            max={10}
            min={0}
            onChange={(event) => setNotaAvaliacaoIa(event.target.value)}
            required
            step="0.1"
            type="number"
            value={notaAvaliacaoIa}
          />
        </label>
        <label>
          Falhas identificadas
          <textarea
            onChange={(event) => setFalhasIdentificadas(event.target.value)}
            rows={3}
            value={falhasIdentificadas}
          />
        </label>
        <label>
          Resumo do atendimento
          <textarea
            onChange={(event) => setResumoAtendimento(event.target.value)}
            rows={3}
            value={resumoAtendimento}
          />
        </label>
        <label>
          Comentário da revisão (opcional)
          <textarea
            onChange={(event) => setComentario(event.target.value)}
            rows={2}
            value={comentario}
          />
        </label>
      </div>

      <div className="review-actions">
        <p aria-live="polite">
          {submitState === 'saved' ? 'Conferência salva' : null}
          {submitState === 'error' ? 'Não foi possível salvar a conferência.' : null}
        </p>
        <button
          className="primary-action"
          disabled={submitState === 'saving' || !notaAvaliacaoIaValida}
          type="submit"
        >
          {submitState === 'saving' ? 'Salvando...' : 'Salvar conferência'}
        </button>
      </div>
    </form>
  );
}

function ReviewContent({ detail, onSaved }: { detail: CuradoriaDetail; onSaved: () => void }) {
  const atendimento = detail.atendimento;
  const canWrite = canWriteAsCurador(usePerfil()?.role);
  return (
    <main className="atendimentos-page curadoria-review-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">{atendimento.agenteVoz.nome} / Concluído</p>
          <h1>Revisar Atendimento</h1>
          <p className="atendimento-id">{atendimento.conversationId}</p>
        </div>
        <Link className="back-link" to="/curadoria">Voltar à fila</Link>
      </header>

      <section className="atendimento-facts" aria-label="Dados do Atendimento">
        <div><span>Motivo de Contato</span><strong>{atendimento.motivoContato ?? 'Não informado'}</strong></div>
        <div><span>Duração</span><strong>{formatDuration(atendimento.duracaoSegundos)}</strong></div>
        <div><span>Nota da IA</span><strong>{detail.avaliacaoIa.nota.toLocaleString('pt-BR')}</strong></div>
        <div><span>Resultado IA</span><strong>{detail.avaliacaoIa.aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}</strong></div>
      </section>

      <section className="ia-review-context">
        <p className="panel-label">Leitura da IA</p>
        <h2>Avaliação original</h2>
        <p>{detail.avaliacaoIa.resumoAtendimento ?? 'Resumo não informado.'}</p>
      </section>

      <div className="atendimento-content">
        <section className="transcript-panel">
          <h2>Transcrição</h2>
          <div className="transcript-lines transcript-scroll" data-testid="transcript-scroll">
            {atendimento.transcricao.length === 0 ? <p>Transcrição ainda não disponível.</p> : atendimento.transcricao.map((entry, index) => (
              <article className={`transcript-line transcript-${entry.role}`} key={`${entry.time_in_call_secs}-${index}`}>
                <span>{entry.role === 'agent' ? atendimento.agenteVoz.nome : 'Cliente'}</span>
                <p>{entry.message}</p>
              </article>
            ))}
          </div>
        </section>
        <aside className="audio-panel">
          <p className="panel-label">Áudio</p>
          <h2>Ouça antes de decidir</h2>
          {atendimento.audioUrl ? <audio controls preload="metadata" src={atendimento.audioUrl}>Seu navegador não suporta reprodução de áudio.</audio> : <p>Áudio ainda não disponível.</p>}
        </aside>
      </div>

      {canWrite ? (
        <ReviewForm detail={detail} onSaved={onSaved} />
      ) : (
        <section className="ia-review-context">
          <p className="panel-label">Consulta somente leitura</p>
          <h2>Conferência humana</h2>
          {detail.avaliacaoMaisRecente ? (
            <>
              <p>
                Nota da Avaliação da IA:{' '}
                {detail.avaliacaoMaisRecente.notaAvaliacaoIa.toLocaleString('pt-BR')}
              </p>
              {detail.avaliacaoMaisRecente.comentario ? (
                <p>{detail.avaliacaoMaisRecente.comentario}</p>
              ) : null}
              <dl className="readonly-checklist">
                {detail.avaliacaoMaisRecente.checklist.map((criterio) => (
                  <div key={criterio.chave}>
                    <dt>
                      {criterio.nome}
                      {criterio.critico ? ' (crítico)' : ''}
                    </dt>
                    <dd>{stateLabels[criterio.estado]}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p>Ainda não há conferência do Curador para este Atendimento.</p>
          )}
        </section>
      )}

      <section className="review-history">
        <div>
          <p className="panel-label">Histórico imutável</p>
          <h2>Revisão mais recente</h2>
          <p>{detail.historico.length} {detail.historico.length === 1 ? 'revisão' : 'revisões'}</p>
        </div>
        {detail.avaliacaoMaisRecente ? (
          <article>
            <strong>{detail.avaliacaoMaisRecente.autor.nome}</strong>
            <span>{dateTime.format(new Date(detail.avaliacaoMaisRecente.criadoEm))}</span>
            <b>{detail.avaliacaoMaisRecente.nota.toLocaleString('pt-BR')} / {detail.avaliacaoMaisRecente.aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}</b>
            <p>
              Nota da Avaliação da IA:{' '}
              <span>{detail.avaliacaoMaisRecente.notaAvaliacaoIa.toLocaleString('pt-BR')}</span>
            </p>
            {detail.avaliacaoMaisRecente.resumoAtendimento ? (
              <p>{detail.avaliacaoMaisRecente.resumoAtendimento}</p>
            ) : null}
            {detail.avaliacaoMaisRecente.falhasIdentificadas.length > 0 ? (
              <ul>
                {detail.avaliacaoMaisRecente.falhasIdentificadas.map((falha) => (
                  <li key={falha}>{falha}</li>
                ))}
              </ul>
            ) : null}
            {detail.avaliacaoMaisRecente.comentario ? (
              <p>{detail.avaliacaoMaisRecente.comentario}</p>
            ) : null}
            <dl>
              {detail.avaliacaoMaisRecente.checklist.map((criterio) => (
                <div key={criterio.chave}>
                  <dt>{criterio.nome}</dt>
                  <dd>{stateLabels[criterio.estado]}</dd>
                </div>
              ))}
            </dl>
          </article>
        ) : <p>A primeira conferência ainda não foi salva.</p>}
        {detail.historico.length > 1 ? (
          <details>
            <summary>Consultar revisões anteriores</summary>
            <ol>
              {detail.historico.slice(1).map((avaliacao) => (
                <li key={avaliacao.id}>
                  <p>
                    {dateTime.format(new Date(avaliacao.criadoEm))} ·{' '}
                    {avaliacao.autor.nome} · Nota{' '}
                    {avaliacao.nota.toLocaleString('pt-BR')} · Nota da Avaliação da IA{' '}
                    {avaliacao.notaAvaliacaoIa.toLocaleString('pt-BR')}
                  </p>
                  {avaliacao.comentario ? <p>{avaliacao.comentario}</p> : null}
                  <dl>
                    {avaliacao.checklist.map((criterio) => (
                      <div key={criterio.chave}>
                        <dt>{criterio.nome}</dt>
                        <dd>{stateLabels[criterio.estado]}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </section>
      <ComentariosPanel atendimentoId={atendimento.id} />
    </main>
  );
}

export function CuradoriaReviewPage() {
  const { atendimentoId } = useParams();
  const [revision, setRevision] = useState(0);
  const state = useAuthenticatedResource(
    `/curadoria/${atendimentoId ?? ''}?revision=${revision}`,
    curadoriaDetailSchema
  );
  if (state.status !== 'ready') {
    return (
      <main className="atendimentos-page">
        <p className="atendimentos-state">
          {state.status === 'loading' ? 'Carregando conferência...' : 'Não foi possível carregar o Atendimento.'}
        </p>
      </main>
    );
  }
  return <ReviewContent detail={state.data} onSaved={() => setRevision((current) => current + 1)} />;
}
