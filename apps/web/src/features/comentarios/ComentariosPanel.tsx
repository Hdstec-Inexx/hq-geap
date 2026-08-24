import {
  comentarioSchema,
  comentariosFilaPageSchema,
  comentariosSchema,
  type Comentario
} from '@hq-geap/contracts/comentarios';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl, getSession } from '../auth/session';
import { canWriteAsCurador, usePerfil } from '../auth/perfil-context';
import { useAuthenticatedResource } from '../atendimentos/api';
import {
  countPendingComentarios,
  determineQueueAdvanceTarget,
  extractQueueFiltersFromFromParam,
  isMaintenanceQueueOrigin
} from '../admin/comentarios/comentarios-fila-logic';
import { ComentarioCard } from './ComentarioCard';

export function ComentariosPanel({
  atendimentoId,
  from
}: {
  atendimentoId: string;
  from?: string | null;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromContext = from ?? searchParams.get('from');

  const [revision, setRevision] = useState(0);
  const [texto, setTexto] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'error'>('idle');

  const [localComentarios, setLocalComentarios] = useState<Comentario[] | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Record<string, boolean>>({});
  const [resolveErrors, setResolveErrors] = useState<Record<string, boolean>>({});
  const isNavigatingRef = useRef(false);

  const perfil = usePerfil();
  const canWrite = canWriteAsCurador(perfil?.role);
  const isAdmin = perfil?.role === 'admin';

  const state = useAuthenticatedResource(
    `/atendimentos/${atendimentoId}/comentarios?revision=${revision}`,
    comentariosSchema
  );

  useEffect(() => {
    if (state.status === 'ready') {
      setLocalComentarios(state.data);
    }
  }, [state.status, state.path]);

  const comentarios = localComentarios ?? (state.status === 'ready' ? state.data : []);

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

  async function resolveComentario(comentarioId: string) {
    const session = getSession();
    if (!session) return;

    setResolvingIds((prev) => ({ ...prev, [comentarioId]: true }));
    setResolveErrors((prev) => ({ ...prev, [comentarioId]: false }));

    try {
      const response = await fetch(`${apiUrl}/comentarios/${comentarioId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${session.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ status: 'resolvido' })
      });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const resolved = comentarioSchema.parse(await response.json());

      const base = localComentarios ?? (state.status === 'ready' ? state.data : []);
      const updatedList = base.map((c) =>
        c.id === comentarioId ? resolved : c
      );
      setLocalComentarios(updatedList);
      setResolvingIds((prev) => ({ ...prev, [comentarioId]: false }));

      const remainingPending = countPendingComentarios(updatedList);
      if (
        remainingPending === 0 &&
        isMaintenanceQueueOrigin(fromContext) &&
        !isNavigatingRef.current
      ) {
        isNavigatingRef.current = true;
        const filters = extractQueueFiltersFromFromParam(fromContext!);
        const query = new URLSearchParams({
          status: 'pendente',
          limite: '50'
        });
        if (filters.inicio) query.set('inicio', filters.inicio);
        if (filters.fim) query.set('fim', filters.fim);
        if (filters.conversationId) {
          query.set('conversationId', filters.conversationId);
        }

        try {
          const queueResponse = await fetch(
            `${apiUrl}/comentarios?${query.toString()}`,
            {
              headers: { authorization: `Bearer ${session.token}` }
            }
          );
          if (!queueResponse.ok) throw new Error(`Queue fetch failed`);
          const queuePage = comentariosFilaPageSchema.parse(
            await queueResponse.json()
          );
          const advanceTarget = determineQueueAdvanceTarget(
            atendimentoId,
            queuePage.items,
            fromContext!
          );
          navigate(advanceTarget.to);
        } catch {
          navigate(fromContext!);
        }
      }
    } catch {
      setResolvingIds((prev) => ({ ...prev, [comentarioId]: false }));
      setResolveErrors((prev) => ({ ...prev, [comentarioId]: true }));
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

      {state.status === 'loading' && localComentarios === null ? (
        <p>Carregando comentários...</p>
      ) : null}
      {state.status === 'error' && localComentarios === null ? (
        <p>Não foi possível carregar os comentários.</p>
      ) : null}
      {((state.status === 'ready' && state.data.length === 0) || (localComentarios !== null && localComentarios.length === 0)) ? (
        <p>Nenhum comentário registrado.</p>
      ) : null}
      {comentarios.length > 0 ? (
        <div className="comentarios-lista">
          {comentarios.map((comentario) => {
            const isResolving = Boolean(resolvingIds[comentario.id]);
            const hasError = Boolean(resolveErrors[comentario.id]);
            return (
              <ComentarioCard comentario={comentario} key={comentario.id}>
                {isAdmin && comentario.status === 'pendente' ? (
                  <div className="manutencao-actions">
                    <span aria-live="polite">
                      {hasError ? 'Não foi possível resolver o comentário.' : null}
                    </span>
                    <button
                      className="primary-action"
                      disabled={isResolving}
                      onClick={() => resolveComentario(comentario.id)}
                      type="button"
                    >
                      {isResolving ? 'Resolvendo...' : 'Marcar como resolvido'}
                    </button>
                  </div>
                ) : null}
              </ComentarioCard>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
