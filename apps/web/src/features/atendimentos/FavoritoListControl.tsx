import { useToggleFavorito } from './useToggleFavorito';

type FavoritoListControlProps = {
  atendimentoId: string;
  isCurador: boolean;
  favoritadoPeloUsuario?: boolean;
  favoritosCount?: number;
  favoritosPerfis?: string[];
};

export function FavoritoListControl({
  atendimentoId,
  isCurador,
  favoritadoPeloUsuario = false,
  favoritosCount = 0,
  favoritosPerfis = []
}: FavoritoListControlProps) {
  const toggleState = useToggleFavorito(atendimentoId, favoritadoPeloUsuario);

  if (isCurador) {
    return (
      <button
        aria-label={toggleState.favoritado ? 'Desfavoritar atendimento' : 'Favoritar atendimento'}
        aria-pressed={toggleState.favoritado}
        className={`favorito-star-button ${toggleState.favoritado ? 'active' : ''}`}
        data-testid="favorito-list-button"
        disabled={toggleState.isSubmitting}
        onClick={() => void toggleState.toggle()}
        type="button"
      >
        <span aria-hidden="true" className="favorito-star-icon">
          {toggleState.favoritado ? '★' : '☆'}
        </span>
        <span className="favorito-label">{toggleState.favoritado ? 'Favoritado' : 'Favoritar'}</span>
      </button>
    );
  }

  if (favoritosCount < 1) return null;

  const nomes = favoritosPerfis.join(', ');
  return (
    <span
      aria-label={`Favoritado por ${nomes}`}
      className="favoritos-readonly-indicator"
      data-testid="favoritos-list-readonly"
      data-tooltip={nomes}
      role="img"
      tabIndex={0}
      title={`Favoritado por: ${nomes}`}
    >
      <span aria-hidden="true" className="favorito-star-icon">★</span>
      <span className="favoritos-readonly-text">{favoritosCount}</span>
    </span>
  );
}
