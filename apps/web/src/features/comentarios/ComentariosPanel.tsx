import {
  comentarioSchema,
  comentariosSchema
} from '@hq-geap/contracts/comentarios';
import { useState } from 'react';
import { apiUrl, getSession } from '../auth/session';
import { canWriteAsCurador, usePerfil } from '../auth/perfil-context';
import { useAuthenticatedResource } from '../atendimentos/api';
import { ComentarioCard } from './ComentarioCard';

export function ComentariosPanel({ atendimentoId }: { atendimentoId: string }) {
  const [revision, setRevision] = useState(0);
  const [texto, setTexto] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'error'>('idle');
  const canWrite = canWriteAsCurador(usePerfil()?.role);
  const state = useAuthenticatedResource(
    `/atendimentos/${atendimentoId}/comentarios?revision=${revision}`,
    comentariosSchema
  );

  async function createComentario(event: React.FormEvent) {
    event.preventDefault();
    const session = getSession();
    if (!session || !texto.trim()) return;
    setSubmitState('saving');
    try {
      const response = await fetch(
        `${apiUrl}/atendimentos/${atendimentoId}/comentarios`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ texto })
        }
      );
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      comentarioSchema.parse(await response.json());
      setTexto('');
      setSubmitState('idle');
      setRevision((current) => current + 1);
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <section className="comentarios-panel">
      <div>
        <p className="panel-label">Manutenção contínua</p>
        <h2>Comentários</h2>
        <p>Anotações sobre este Atendimento e possíveis ajustes do Agente de Voz.</p>
      </div>

      {canWrite ? (
        <form className="comentario-form" onSubmit={createComentario}>
          <label htmlFor={`comentario-${atendimentoId}`}>Novo comentário</label>
          <textarea
            id={`comentario-${atendimentoId}`}
            maxLength={4000}
            onChange={(event) => setTexto(event.target.value)}
            required
            rows={3}
            value={texto}
          />
          <div>
            <span aria-live="polite">
              {submitState === 'error' ? 'Não foi possível salvar o comentário.' : null}
            </span>
            <button
              className="primary-action"
              disabled={submitState === 'saving' || !texto.trim()}
              type="submit"
            >
              {submitState === 'saving' ? 'Salvando...' : 'Adicionar comentário'}
            </button>
          </div>
        </form>
      ) : null}

      {state.status === 'loading' ? <p>Carregando comentários...</p> : null}
      {state.status === 'error' ? <p>Não foi possível carregar os comentários.</p> : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <p>Nenhum comentário registrado.</p>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <div className="comentarios-lista">
          {state.data.map((comentario) => (
            <ComentarioCard comentario={comentario} key={comentario.id} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
