import { useState, useEffect } from 'react';
import type { MutacaoFavoritoResponse } from '@hq-geap/contracts/atendimentos';
import { apiUrl, getSession } from '../auth/session';

export function useToggleFavorito(
  atendimentoId: string | null | undefined,
  initialFavoritado = false
) {
  const [favoritado, setFavoritado] = useState<boolean>(initialFavoritado);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFavoritado(initialFavoritado);
  }, [initialFavoritado]);

  async function toggle() {
    if (!atendimentoId || isSubmitting) return;
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

  return {
    favoritado,
    isSubmitting,
    toggle
  };
}
