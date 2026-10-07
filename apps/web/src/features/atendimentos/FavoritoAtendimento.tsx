import type { FavoritosInfo } from '@hq-geap/contracts/atendimentos';
import { usePerfil } from '../auth/perfil-context';
import { formatPerfisFavoritos } from './favorito-logic';
import { useToggleFavorito } from './useToggleFavorito';

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
  const { favoritado, isSubmitting, toggle } = useToggleFavorito(
    atendimentoId,
    Boolean(favoritadoPeloUsuario)
  );

  const role = perfil?.role;

  if (role === 'curador') {
    return (
      <button
        type="button"
        className={`favorito-star-button ${favoritado ? 'active' : ''}`}
        onClick={toggle}
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
