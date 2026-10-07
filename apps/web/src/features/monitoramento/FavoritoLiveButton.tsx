import { useState, useEffect } from 'react';
import type { MutacaoFavoritoResponse } from '@hq-geap/contracts/atendimentos';
import { usePerfil } from '../auth/perfil-context';
import { apiUrl, getSession } from '../auth/session';

type FavoritoLiveButtonProps = {
  conversationId: string;
  isPersisted: boolean;
  atendimentoId?: string | null;
  initialFavoritado?: boolean;
};

export function FavoritoLiveButton({
  conversationId,
  isPersisted,
  atendimentoId,
  initialFavoritado = false
}: FavoritoLiveButtonProps) {
  const perfil = usePerfil();
  const [favoritado, setFavoritado] = useState<boolean>(initialFavoritado);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFavoritado(initialFavoritado);
  }, [initialFavoritado]);

  const role = perfil?.role;
  const canMutate = role === 'curador';
  const isDisabled = !isPersisted || !atendimentoId || !canMutate || isSubmitting;

  let title = 'Favoritar atendimento';
  if (!isPersisted || !atendimentoId) {
    title = 'A conversa ainda não foi persistida no HQ';
  } else if (!canMutate) {
    title = 'Apenas Curadores podem favoritar';
  } else if (favoritado) {
    title = 'Desfavoritar atendimento';
  }

  async function handleToggle() {
    if (isDisabled || !atendimentoId) return;

    const session = getSession();
    if (!session) return;

    const nextFavoritado = !favoritado;
    setIsSubmitting(true);
    setFavoritado(nextFavoritado);

    try {
      const method = nextFavoritado ? 'POST' : 'DELETE';
      const response = await fetch(`${apiUrl}/atendimentos/${atendimentoId}/favorito`, {
        method,
        headers: {
          authorization: `Bearer ${session.token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data: MutacaoFavoritoResponse = await response.json();
      setFavoritado(data.favoritadoPeloUsuario);
    } catch {
      setFavoritado(!nextFavoritado);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      className={`favorito-star-button ${favoritado ? 'active' : ''}`}
      onClick={handleToggle}
      disabled={isDisabled}
      aria-pressed={favoritado}
      aria-label={favoritado ? 'Desfavoritar atendimento' : 'Favoritar atendimento'}
      title={title}
      data-testid="favorito-live-button"
    >
      <span className="favorito-star-icon" aria-hidden="true">
        {favoritado ? '★' : '☆'}
      </span>
      <span className="favorito-label">{favoritado ? 'Favoritado' : 'Favoritar'}</span>
    </button>
  );
}
