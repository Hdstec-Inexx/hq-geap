import { usePerfil } from '../auth/perfil-context';
import {
  getAudioDownloadFilename,
  shouldShowAudioDownloadButton,
  triggerAudioDownload
} from './audio-player-logic';

export interface AudioDownloadButtonProps {
  audioUrl: string | null;
  conversationId: string;
}

export function AudioDownloadButton({
  audioUrl,
  conversationId
}: AudioDownloadButtonProps) {
  const perfil = usePerfil();

  if (!shouldShowAudioDownloadButton({ role: perfil?.role, audioUrl }) || !audioUrl) {
    return null;
  }

  const filename = getAudioDownloadFilename(conversationId);

  return (
    <button
      type="button"
      className="audio-download-btn"
      data-testid="audio-download-btn"
      aria-label="Baixar áudio"
      title="Baixar áudio"
      onClick={() => triggerAudioDownload(audioUrl, filename)}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </button>
  );
}

