import { useState } from 'react';
import type { FavoritosInfo, MutacaoFavoritoResponse } from '@hq-geap/contracts/atendimentos';
import { usePerfil } from '../auth/perfil-context';
import { apiUrl, getSession } from '../auth/session';
import { formatPerfisFavoritos } from './favorito-logic';

type FavoritoAtendimentoProps = {
  atendimentoId: string;
  favoritadoPeloUsuario?: boolean;
  favoritos?: FavoritosInfo;
};

export function FavoritoAtendimento({
  atendimentoId,
  favoritadoPeloUsuario,
  favoritos
}: FavoritoAtendimentoProps) {
  const perfil = usePerfil();
  const [favoritado, setFavoritado] = useState<boolean>(Boolean(favoritadoPeloUsuario));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const role = perfil?.role;

  if (role === 'curador') {
    async function handleToggle() {
      const session = getSession();
      if (!session || isSubmitting) return;

      const nextFavoritado = !favoritado;
      setIsSubmitting(true);
      // Optimistic update
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
        // Rollback on error
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
        disabled={isSubmitting}
        aria-pressed={favoritado}
        aria-label={favoritado ? 'Desfavoritar atendimento' : 'Favoritar atendimento'}
        title={favoritado ? 'Desfavoritar atendimento' : 'Favoritar atendimento'}
        data-testid="favorito-button"
      >
        <span className="favorito-star-icon" aria-hidden="true">
          {favoritado ? '★' : '☆'}
        </span>
        <span className="favorito-label">{favoritado ? 'Favoritado' : 'Favoritar'}</span>
      </button>
    );
  }

  if (role === 'gestao' || role === 'admin') {
    const perfis = favoritos?.perfis ?? [];
    const count = favoritos?.count ?? 0;
    const label = formatPerfisFavoritos(perfis);

    return (
      <div
        className="favoritos-readonly-indicator"
        aria-label="Perfis que favoritaram"
        title={label}
        data-testid="favoritos-readonly"
      >
        <span className="favorito-star-icon" aria-hidden="true">
          {count > 0 ? '★' : '☆'}
        </span>
        <span className="favorito-readonly-text">{label}</span>
      </div>
    );
  }

  return null;
}
