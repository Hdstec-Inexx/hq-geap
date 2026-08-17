import { useRef } from 'react';
import {
  atendimentoDetailSchema,
  type AtendimentoDetail
} from '@hq-geap/contracts/atendimentos';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AvaliacaoCuradorPanel } from '../avaliacoes/AvaliacaoCuradorPanel';
import { AvaliacaoIaPanel } from '../avaliacoes/AvaliacaoIaPanel';
import { ComentariosPanel } from '../comentarios/ComentariosPanel';
import { AudioPlayer, Miniplayer, TranscriptPanel, useAudioPlayer } from '../player';
import { formatDuration, useAuthenticatedResource } from './api';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD'
});

function AtendimentoMedia({ atendimento }: { atendimento: AtendimentoDetail }) {
  const mainPlayerRef = useRef<HTMLElement | null>(null);
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
          headerContent={<p className="panel-label">Transcrição</p>}
        />
        <aside ref={mainPlayerRef} className="audio-panel">
          <p className="panel-label">Áudio</p>
          <h2>Ouça o contato completo</h2>
          <AudioPlayer audioUrl={atendimento.audioUrl} controller={player} />
        </aside>
      </div>
    </>
  );
}

export function AtendimentoPage() {
  const { atendimentoId } = useParams();
  const [searchParams] = useSearchParams();
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
        <Link
          className="back-link"
          to={searchParams.toString() ? `/atendimentos?${searchParams}` : '/atendimentos'}
        >
          Voltar à lista
        </Link>
      </header>

      <section className="atendimento-facts" aria-label="Dados do Atendimento">
        <div><span>Motivo de Contato</span><strong>{atendimento.motivoContato ?? 'Não informado'}</strong></div>
        <div><span>Duração</span><strong>{formatDuration(atendimento.duracaoSegundos)}</strong></div>
        <div><span>Transferência</span><strong>{atendimento.houveTransferencia ? 'Realizada' : 'Não realizada'}</strong></div>
        {atendimento.custo !== undefined ? <div><span>Custo</span><strong>{atendimento.custo === null ? 'Não disponível' : currency.format(atendimento.custo)}</strong></div> : null}
      </section>

      {atendimento.status === 'em_andamento' ? (
        <p className="atendimentos-state">
          <Link to={`/monitoramento/${atendimento.conversationId}`}>
            Abrir Monitoramento ao Vivo
          </Link>
        </p>
      ) : null}

      {atendimento.status === 'concluido' ? (
        <div className="avaliacoes-lado-a-lado">
          <AvaliacaoIaPanel atendimentoId={atendimento.id} />
          <AvaliacaoCuradorPanel atendimentoId={atendimento.id} />
        </div>
      ) : null}

      <AtendimentoMedia atendimento={atendimento} />
      <ComentariosPanel atendimentoId={atendimento.id} />
    </main>
  );
}
