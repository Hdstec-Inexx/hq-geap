import type { CSSProperties } from 'react';
import { formatPlayerTime } from './audio-player-logic';
import { PlaybackSpeedControl } from './PlaybackSpeedControl';
import type { AudioPlayerController } from './useAudioPlayer';

export interface AudioPlayerProps {
  audioUrl: string | null;
  controller: AudioPlayerController;
}

export function AudioPlayer({ audioUrl, controller }: AudioPlayerProps) {
  if (!audioUrl) {
    return <p className="audio-unavailable">Áudio ainda não disponível.</p>;
  }

  const {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    setPlaybackRate,
    cyclePlaybackRate,
    togglePlay,
    seek,
    skip,
    onTimeUpdate,
    onLoadedMetadata,
    onDurationChange,
    onPlay,
    onPause,
    onEnded
  } = controller;

  const effectiveDuration = duration > 0 ? duration : 0;
  const progressPercent =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div className="audio-player-component" data-testid="audio-player">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />

      <div className="audio-player-time" aria-live="off">
        <span className="audio-current-time" data-testid="audio-current-time">
          {formatPlayerTime(currentTime)}
        </span>
        <span className="audio-time-divider">/</span>
        <span className="audio-total-duration" data-testid="audio-total-duration">
          {formatPlayerTime(effectiveDuration)}
        </span>
      </div>

      <div className="audio-player-slider-container">
        <input
          type="range"
          className="audio-player-progress"
          data-testid="audio-progress-bar"
          min={0}
          max={effectiveDuration}
          step={0.1}
          value={currentTime}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Progresso do áudio"
          style={{ '--progress-percent': `${progressPercent}%` } as CSSProperties}
        />
      </div>

      <div className="audio-player-controls">
        <button
          type="button"
          className="audio-player-btn audio-skip-btn audio-skip-back"
          data-testid="audio-skip-back"
          onClick={() => skip(-30)}
          aria-label="Voltar 30 segundos"
          title="Voltar 30 segundos"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1 4v6h6" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          <span>-30s</span>
        </button>

        <button
          type="button"
          className={`audio-player-btn audio-play-btn ${isPlaying ? 'is-playing' : 'is-paused'}`}
          data-testid="audio-play-pause-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
          title={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="audio-player-btn audio-skip-btn audio-skip-forward"
          data-testid="audio-skip-forward"
          onClick={() => skip(30)}
          aria-label="Avançar 30 segundos"
          title="Avançar 30 segundos"
        >
          <span>+30s</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M23 4v6h-6" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        <PlaybackSpeedControl
          playbackRate={playbackRate}
          onSelect={setPlaybackRate}
          variant="main"
        />
      </div>
    </div>
  );
}
