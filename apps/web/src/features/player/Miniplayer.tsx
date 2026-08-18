import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import {
  formatPlayerTime,
  shouldShowMiniplayer
} from './audio-player-logic';
import { PlaybackSpeedControl } from './PlaybackSpeedControl';
import type { AudioPlayerController } from './useAudioPlayer';

export interface MiniplayerProps {
  audioUrl: string | null;
  controller: AudioPlayerController;
  mainPlayerRef: RefObject<HTMLElement | null>;
  title?: string;
}

export function Miniplayer({
  audioUrl,
  controller,
  mainPlayerRef,
  title = 'Áudio do Atendimento'
}: MiniplayerProps) {
  const [isPastMainPlayer, setIsPastMainPlayer] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  // Check touch capabilities on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(hover: none), (pointer: coarse)');
    setIsTouch(mediaQuery.matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

    const handler = (e: MediaQueryListEvent) => {
      setIsTouch(e.matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, []);

  // Monitor scroll position relative to the main player
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let rafId: number | null = null;

    const checkPosition = () => {
      const el = mainPlayerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      // Scrolled past when the bottom of the main player is at or above the top of viewport
      const past = rect.bottom <= 0;
      setIsPastMainPlayer(past);

      // Ensure observer is attached to the element
      if (!observer && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          () => {
            scheduleCheck();
          },
          {
            threshold: [0, 0.25, 0.5, 0.75, 1]
          }
        );
        observer.observe(el);
      }
    };

    const scheduleCheck = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkPosition();
      });
    };

    checkPosition();

    window.addEventListener('scroll', scheduleCheck, { passive: true });
    window.addEventListener('resize', scheduleCheck, { passive: true });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('scroll', scheduleCheck);
      window.removeEventListener('resize', scheduleCheck);
    };
  }, [mainPlayerRef]);

  const active = shouldShowMiniplayer({
    isPastMainPlayer,
    hasEnded: controller.hasEnded,
    hasAudioUrl: Boolean(audioUrl)
  });

  if (!active || !audioUrl) {
    return null;
  }

  const {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    setPlaybackRate,
    cyclePlaybackRate,
    togglePlay,
    seek,
    skip
  } = controller;

  const effectiveDuration = duration > 0 ? duration : 0;
  const progressPercent =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div
      className={`miniplayer-container ${isTouch ? 'is-touch' : ''} ${isHovered ? 'is-hovered' : ''}`}
      data-testid="miniplayer-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsHovered(false);
        }
      }}
    >
      <div
        className="miniplayer-trigger-strip"
        data-testid="miniplayer-trigger"
        aria-hidden="true"
      />

      <aside
        className="miniplayer-panel"
        data-testid="miniplayer"
        role="region"
        aria-label="Miniplayer persistente"
      >
        <div className="miniplayer-content">
          <div className="miniplayer-info">
            <span className="miniplayer-title" title={title}>
              {title}
            </span>
            <div className="miniplayer-time" aria-live="off">
              <span className="miniplayer-current-time" data-testid="miniplayer-current-time">
                {formatPlayerTime(currentTime)}
              </span>
              <span className="miniplayer-time-divider">/</span>
              <span className="miniplayer-total-duration" data-testid="miniplayer-total-duration">
                {formatPlayerTime(effectiveDuration)}
              </span>
            </div>
          </div>

          <div className="miniplayer-slider-container">
            <input
              type="range"
              className="miniplayer-progress audio-player-progress"
              data-testid="miniplayer-progress-bar"
              min={0}
              max={effectiveDuration}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Progresso do áudio"
              style={{ '--progress-percent': `${progressPercent}%` } as CSSProperties}
            />
          </div>

          <div className="miniplayer-controls">
            <button
              type="button"
              className="miniplayer-btn miniplayer-skip-btn"
              data-testid="miniplayer-skip-back"
              onClick={() => skip(-30)}
              aria-label="Voltar 30 segundos"
              title="Voltar 30 segundos"
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
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>-30s</span>
            </button>

            <button
              type="button"
              className={`miniplayer-btn miniplayer-play-btn ${isPlaying ? 'is-playing' : 'is-paused'}`}
              data-testid="miniplayer-play-pause-btn"
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
              className="miniplayer-btn miniplayer-skip-btn"
              data-testid="miniplayer-skip-forward"
              onClick={() => skip(30)}
              aria-label="Avançar 30 segundos"
              title="Avançar 30 segundos"
            >
              <span>+30s</span>
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
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>

            <PlaybackSpeedControl
              playbackRate={playbackRate}
              onCycle={cyclePlaybackRate}
              onSelect={setPlaybackRate}
              variant="mini"
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
