import { usePerfil } from '../auth/perfil-context';
import { useToggleFavorito } from '../atendimentos/useToggleFavorito';

type FavoritoLiveButtonProps = {
  conversationId: string;
  isPersisted: boolean;
  atendimentoId?: string | null;
  initialFavoritado?: boolean;
};

export function FavoritoLiveButton({
  isPersisted,
  atendimentoId,
  initialFavoritado = false
}: FavoritoLiveButtonProps) {
  const perfil = usePerfil();
  const { favoritado, isSubmitting, toggle } = useToggleFavorito(
    atendimentoId,
    initialFavoritado
  );

  const role = perfil?.role;
  const canMutate = role === 'curador';
  const isDisabled = !isPersisted || !atendimentoId || !canMutate || isSubmitting;

  let title = 'Favoritar atendimento';
  if (!isPersisted || !atendimentoId) {
    title = 'O Atendimento ainda não foi persistido no HQ';
  } else if (!canMutate) {
    title = 'Apenas Curadores podem favoritar';
  } else if (favoritado) {
    title = 'Desfavoritar atendimento';
  }

  return (
    <button
      type="button"
      className={`favorito-star-button ${favoritado ? 'active' : ''}`}
      onClick={toggle}
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
