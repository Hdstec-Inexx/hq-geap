import type { ReactNode } from 'react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { extractTurnTime, formatPlayerTime, getActiveTurnIndex } from './audio-player-logic';

export interface TranscriptEntry {
  role: 'agent' | 'user';
  message: string;
  time_in_call_secs?: number;
  tempo_segundos?: number;
}

export interface TranscriptPanelProps {
  transcricao: TranscriptEntry[];
  agenteNome: string;
  currentTime: number;
  onSeek: (time: number) => void;
  headerContent?: ReactNode;
}

interface TranscriptLineProps {
  entry: TranscriptEntry;
  index: number;
  isActive: boolean;
  agenteNome: string;
  onSeek: (time: number) => void;
  setRef: (el: HTMLElement | null) => void;
}

const TranscriptLine = React.memo(function TranscriptLine({
  entry,
  index,
  isActive,
  agenteNome,
  onSeek,
  setRef
}: TranscriptLineProps) {
  const messageText =
    entry.message && entry.message.trim() !== ''
      ? entry.message
      : '[Sem mensagem verbal]';
  const speaker = entry.role === 'agent' ? agenteNome : 'Cliente';
  const turnTime = extractTurnTime(entry) ?? 0;
  const formattedTime = formatPlayerTime(turnTime);

  return (
    <article
      ref={setRef}
      className={`transcript-line transcript-${entry.role} ${isActive ? 'active' : ''}`}
      onClick={() => onSeek(turnTime)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSeek(turnTime);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${speaker} aos ${formattedTime}: ${messageText}`}
      data-testid={`transcript-turn-${index}`}
      data-time={turnTime}
    >
      <span>
        {speaker} · {formattedTime}
      </span>
      <p>{messageText}</p>
    </article>
  );
});

export function TranscriptPanel({
  transcricao,
  agenteNome,
  currentTime,
  onSeek,
  headerContent
}: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef<(HTMLElement | null)[]>([]);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    turnRefs.current = [];
  }, [transcricao]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const activeTurnIndex = getActiveTurnIndex(transcricao, currentTime);

  const scrollToTurn = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container || index < 0) return;
    const element = turnRefs.current[index];
    if (!element) return;

    isProgrammaticScrollRef.current = true;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
    const targetScrollTop = relativeTop - container.clientHeight / 2 + elementRect.height / 2;

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth'
    });

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 400);
  }, []);

  useEffect(() => {
    if (!isAutoScrollPaused && activeTurnIndex >= 0) {
      scrollToTurn(activeTurnIndex);
    }
  }, [activeTurnIndex, isAutoScrollPaused, scrollToTurn]);

  const handleUserScrollInput = useCallback(() => {
    isProgrammaticScrollRef.current = false;
    setIsAutoScrollPaused(true);
  }, []);

  const handleScroll = useCallback(() => {
    if (!isProgrammaticScrollRef.current) {
      setIsAutoScrollPaused(true);
    }
  }, []);

  const handleResumeAutoScroll = useCallback(() => {
    setIsAutoScrollPaused(false);
    const targetIndex = activeTurnIndex >= 0 ? activeTurnIndex : 0;
    scrollToTurn(targetIndex);
  }, [activeTurnIndex, scrollToTurn]);

  return (
    <section className="transcript-panel" aria-label="Transcrição do Atendimento">
      {headerContent ?? <p className="panel-label">Transcrição</p>}

      <div className="transcript-container-wrapper">
        <div
          ref={containerRef}
          className="transcript-lines transcript-scroll"
          data-testid="transcript-scroll"
          onWheel={handleUserScrollInput}
          onTouchMove={handleUserScrollInput}
          onScroll={handleScroll}
          onKeyDown={(e) => {
            if (
              ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)
            ) {
              handleUserScrollInput();
            }
          }}
        >
          {transcricao.length === 0 ? (
            <p>Transcrição ainda não disponível.</p>
          ) : (
            transcricao.map((entry, index) => (
              <TranscriptLine
                key={`${extractTurnTime(entry) ?? index}-${index}`}
                entry={entry}
                index={index}
                isActive={index === activeTurnIndex}
                agenteNome={agenteNome}
                onSeek={onSeek}
                setRef={(el) => {
                  turnRefs.current[index] = el;
                }}
              />
            ))
          )}
        </div>

        {isAutoScrollPaused && transcricao.length > 0 && (
          <div className="transcript-floating-actions">
            <button
              type="button"
              className="transcript-resume-scroll-btn"
              data-testid="transcript-resume-scroll"
              onClick={handleResumeAutoScroll}
              aria-label="Voltar ao momento atual"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
              <span>Voltar ao momento atual</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
