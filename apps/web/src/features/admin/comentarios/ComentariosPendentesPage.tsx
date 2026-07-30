import {
  comentarioSchema,
  comentariosFilaSchema,
  type ComentarioFila,
  type StatusComentario
} from '@hq-geap/contracts/comentarios';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, getSession } from '../../auth/session';
import { useAuthenticatedResource } from '../../atendimentos/api';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

function FilaItem({
  comentario,
  onResolved
}: {
  comentario: ComentarioFila;
  onResolved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function resolve() {
    const session = getSession();
    if (!session) return;
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(`${apiUrl}/comentarios/${comentario.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${session.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ status: 'resolvido' })
      });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      comentarioSchema.parse(await response.json());
      onResolved();
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  return (
    <article className="manutencao-item">
      <div className="manutencao-item-heading">
        <div>
          <p className="panel-label">{comentario.atendimento.agenteVozNome}</p>
          <Link to={`/atendimentos/${comentario.atendimento.id}`}>
            {comentario.atendimento.conversationId}
          </Link>
        </div>
        <span className={`comentario-status status-${comentario.status}`}>
          {comentario.status === 'pendente' ? 'Pendente' : 'Resolvido'}
        </span>
      </div>
      <p>{comentario.texto}</p>
      <small>
        {comentario.autor.nome} · {dateTime.format(new Date(comentario.criadoEm))}
      </small>
      {comentario.resolucao ? (
        <small>
          Resolvido por {comentario.resolucao.responsavel.nome} em{' '}
          {dateTime.format(new Date(comentario.resolucao.resolvidoEm))}
        </small>
      ) : null}
      {comentario.status === 'pendente' ? (
        <div className="manutencao-actions">
          <span aria-live="polite">
            {error ? 'Não foi possível resolver o comentário.' : null}
          </span>
          <button
            className="primary-action"
            disabled={saving}
            onClick={resolve}
            type="button"
          >
            {saving ? 'Resolvendo...' : 'Marcar como resolvido'}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ComentariosPendentesPage() {
  const [status, setStatus] = useState<StatusComentario>('pendente');
  const [revision, setRevision] = useState(0);
  const state = useAuthenticatedResource(
    `/comentarios?status=${status}&revision=${revision}`,
    comentariosFilaSchema
  );

  return (
    <main className="atendimentos-page manutencao-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Administração / Agente de Voz</p>
          <h1>Fila de manutenção</h1>
          <p>Trabalhe os comentários usados para melhorar continuamente o agente.</p>
        </div>
        <label className="manutencao-filter">
          Status
          <select
            onChange={(event) => setStatus(event.target.value as StatusComentario)}
            value={status}
          >
            <option value="pendente">Pendente</option>
            <option value="resolvido">Resolvido</option>
          </select>
        </label>
      </header>

      {state.status === 'loading' ? <p>Carregando fila...</p> : null}
      {state.status === 'error' ? <p>Não foi possível carregar a fila.</p> : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <section className="manutencao-empty">
          <h2>Nenhum comentário {status}</h2>
          <p>A fila está em dia para este status.</p>
        </section>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <section className="manutencao-lista" aria-label="Comentários da fila">
          {state.data.map((comentario) => (
            <FilaItem
              comentario={comentario}
              key={comentario.id}
              onResolved={() => setRevision((current) => current + 1)}
            />
          ))}
        </section>
      ) : null}
    </main>
  );
}
