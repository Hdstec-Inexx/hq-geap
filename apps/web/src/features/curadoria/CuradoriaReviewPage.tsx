import {
  avaliacaoCuradorSchema,
  curadoriaDetailSchema,
  type AvaliacaoCurador,
  type CuradoriaDetail
} from '@hq-geap/contracts/curadoria';
import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { curadoriasRealizadasHref, filaHref } from './pagination';
import {
  getInitialReviewFormState,
  shouldShowReadingCardFirst
} from './curadoria-review-logic';
import { apiUrl, getSession } from '../auth/session';

import { canWriteAsCurador, usePerfil } from '../auth/perfil-context';
import { formatAtendimentoDate, formatDuration } from '../atendimentos/atendimento-facts-logic';
import { useAuthenticatedResource } from '../atendimentos/api';
import { formatMotivoContato } from '../atendimentos/motivo-combobox-logic';
import {
  AvaliacaoCuradorPanel,
  dateTime,
  estadoLabels
} from '../avaliacoes/AvaliacaoCuradorPanel';
import { CriterionTooltip } from '../avaliacoes/CriterionTooltip';
import { ComentariosPanel } from '../comentarios/ComentariosPanel';
import {
  AudioDownloadButton,
  AudioPlayer,
  Miniplayer,
  TranscriptPanel,
  useAudioPlayer
} from '../player';

function CuradoriaMedia({ detail }: { detail: CuradoriaDetail }) {
  const mainPlayerRef = useRef<HTMLElement | null>(null);
  const atendimento = detail.atendimento;
  const player = useAudioPlayer({
    audioUrl: atendimento.audioUrl,
    durationSeconds: atendimento.duracaoSegundos
  });

  return (
    <>
      <Miniplayer
        audioUrl={atendimento.audioUrl}
        controller={player}
        mainPlayerRef={mainPlayerRef}
        title={atendimento.agenteVoz.nome}
      />
      <div className="atendimento-content">
        <TranscriptPanel
          transcricao={atendimento.transcricao}
          agenteNome={atendimento.agenteVoz.nome}
          currentTime={player.currentTime}
          onSeek={player.seek}
          headerContent={<h2>Transcrição</h2>}
        />
        <aside ref={mainPlayerRef} className="audio-panel">
          <div className="audio-panel-header">
            <p className="panel-label">Áudio</p>
            <AudioDownloadButton
              audioUrl={atendimento.audioUrl}
              conversationId={atendimento.conversationId}
            />
          </div>
          <h2>Ouça antes de decidir</h2>
          <AudioPlayer audioUrl={atendimento.audioUrl} controller={player} />
        </aside>
      </div>
    </>
  );
}

function ReviewForm({
  detail,
  initialData,
  onCancel,
  onSaved
}: {
  detail: CuradoriaDetail;
  initialData?: AvaliacaoCurador | null;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const [initialState] = useState(() =>
    getInitialReviewFormState(detail.avaliacaoIa, initialData)
  );
  const [estados, setEstados] = useState<Record<string, EstadoCriterio>>(
    () => initialState.estados
  );
  const [notaAvaliacaoIa, setNotaAvaliacaoIa] = useState(
    () => initialState.notaAvaliacaoIa
  );
  const [falhasIdentificadas, setFalhasIdentificadas] = useState(
    () => initialState.falhasIdentificadas
  );
  const [resumoAtendimento, setResumoAtendimento] = useState(
    () => initialState.resumoAtendimento
  );
  const [comentario, setComentario] = useState(
    () => initialState.comentario
  );
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
              <div className="criterion-legend-content">
                <CriterionTooltip
                  chave={criterio.chave}
                  nome={criterio.nome}
                  descricao={criterio.descricao}
                />
                {criterio.critico ? (
                  <span className="criterion-critical-badge">Crítico</span>
                ) : null}
              </div>
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
                    <span>{estadoLabels[estado]}</span>
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
        {onCancel ? (
          <button
            className="secondary-action"
            onClick={onCancel}
            type="button"
          >
            Cancelar reavaliação
          </button>
        ) : null}
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

function getBackLinkInfo(searchParams: URLSearchParams): { to: string; label: string } {
  const from = searchParams.get('from');
  const cleanParams = new URLSearchParams(searchParams);
  cleanParams.delete('from');

  if (from === '/minhas-curadorias' || from === 'minhas-curadorias') {
    return {
      to: curadoriasRealizadasHref('/minhas-curadorias', cleanParams),
      label: 'Voltar a Minhas Curadorias'
    };
  }
  if (from === '/curadorias-realizadas' || from === 'curadorias-realizadas') {
    return {
      to: curadoriasRealizadasHref('/curadorias-realizadas', cleanParams),
      label: 'Voltar a Curadorias Realizadas'
    };
  }
  return {
    to: filaHref(cleanParams),
    label: 'Voltar à fila'
  };
}

function ReviewContent({
  detail,
  searchParams,
  onSaved
}: {
  detail: CuradoriaDetail;
  searchParams: URLSearchParams;
  onSaved: () => void;
}) {
  const atendimento = detail.atendimento;
  const role = usePerfil()?.role;
  const canWrite = canWriteAsCurador(role);
  const hasPreviousReview = detail.avaliacaoMaisRecente !== null;
  const showReadingFirst = shouldShowReadingCardFirst(role, detail.avaliacaoMaisRecente);
  const [isRevising, setIsRevising] = useState(() => !showReadingFirst);
  const backLink = getBackLinkInfo(searchParams);
  return (
    <main className="atendimentos-page curadoria-review-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">{atendimento.agenteVoz.nome} / Concluído</p>
          <h1>Revisar Atendimento</h1>
          <p className="atendimento-id">{atendimento.conversationId}</p>
        </div>
        <Link className="back-link" to={backLink.to}>{backLink.label}</Link>
      </header>

      <section className="atendimento-facts" aria-label="Dados do Atendimento">
        <div><span>Motivo de Contato</span><strong>{formatMotivoContato(atendimento.motivoContato)}</strong></div>
        <div><span>Duração</span><strong>{formatDuration(atendimento.duracaoSegundos)}</strong></div>
        <div><span>Nota da IA</span><strong>{detail.avaliacaoIa.nota.toLocaleString('pt-BR')}</strong></div>
        <div><span>Resultado IA</span><strong>{detail.avaliacaoIa.aprovacao === 'aprovado' ? 'Aprovado' : 'Reprovado'}</strong></div>
        <div><span>Data</span><strong>{formatAtendimentoDate(atendimento)}</strong></div>
      </section>

      <section className="ia-review-context">
        <p className="panel-label">Leitura da IA</p>
        <h2>Avaliação original</h2>
        <p>{detail.avaliacaoIa.resumoAtendimento ?? 'Resumo não informado.'}</p>
      </section>

      <CuradoriaMedia detail={detail} />

      {canWrite && (!hasPreviousReview || isRevising) ? (
        <ReviewForm
          detail={detail}
          initialData={detail.avaliacaoMaisRecente}
          onCancel={hasPreviousReview ? () => setIsRevising(false) : undefined}
          onSaved={onSaved}
        />
      ) : (
        <AvaliacaoCuradorPanel
          action={
            canWrite && hasPreviousReview ? (
              <button
                className="primary-action"
                onClick={() => setIsRevising(true)}
                type="button"
              >
                Fazer nova revisão
              </button>
            ) : undefined
          }
          avaliacao={detail.avaliacaoMaisRecente}
          historico={detail.historico}
          emptyMessage="Ainda não há conferência do Curador para este Atendimento."
        />
      )}

      <ComentariosPanel atendimentoId={atendimento.id} />
    </main>
  );
}

export function CuradoriaReviewPage() {
  const { atendimentoId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const state = useAuthenticatedResource(
    `/curadoria/${atendimentoId ?? ''}`,
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
  return (
    <ReviewContent
      detail={state.data}
      searchParams={searchParams}
      onSaved={() => navigate(getBackLinkInfo(searchParams).to)}
    />
  );
}
