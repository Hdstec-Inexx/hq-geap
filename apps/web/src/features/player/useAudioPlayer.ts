import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, SyntheticEvent } from 'react';
import { clampSeekTime } from './audio-player-logic';

export interface UseAudioPlayerOptions {
  audioUrl?: string | null;
  durationSeconds?: number | null;
}

export interface AudioPlayerController {
  audioRef: RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  hasEnded: boolean;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (delta: number) => void;
  onTimeUpdate: (e: SyntheticEvent<HTMLAudioElement>) => void;
  onLoadedMetadata: (e: SyntheticEvent<HTMLAudioElement>) => void;
  onDurationChange: (e: SyntheticEvent<HTMLAudioElement>) => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
}

export function useAudioPlayer({
  audioUrl,
  durationSeconds
}: UseAudioPlayerOptions): AudioPlayerController {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(() => durationSeconds ?? 0);
  const [hasEnded, setHasEnded] = useState(false);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, []);

  useEffect(() => {
    if (durationSeconds && durationSeconds > 0) {
      setDuration((prev) => (prev > 0 ? prev : durationSeconds));
    }
  }, [durationSeconds]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setHasEnded(false);
  }, [audioUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setHasEnded(false);
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Ignore playback abort or permissions rejections
        });
      }
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback(
    (targetTime: number) => {
      setHasEnded(false);
      const audio = audioRef.current;
      const targetDuration =
        duration > 0
          ? duration
          : audio && Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : 0;
      const clamped = clampSeekTime(targetTime, targetDuration);
      if (audio) {
        audio.currentTime = clamped;
      }
      setCurrentTime(clamped);
    },
    [duration]
  );

  const skip = useCallback(
    (delta: number) => {
      setHasEnded(false);
      const audio = audioRef.current;
      const current = audio ? audio.currentTime : currentTime;
      seek(current + delta);
    },
    [currentTime, seek]
  );

  const handleTimeUpdate = useCallback((e: SyntheticEvent<HTMLAudioElement>) => {
    setCurrentTime(e.currentTarget.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback((e: SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
      setDuration(audio.duration);
    }
  }, []);

  const handleDurationChange = useCallback((e: SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
      setDuration(audio.duration);
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    setHasEnded(false);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setHasEnded(true);
  }, []);

  return {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    hasEnded,
    togglePlay,
    seek,
    skip,
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: handleLoadedMetadata,
    onDurationChange: handleDurationChange,
    onPlay: handlePlay,
    onPause: handlePause,
    onEnded: handleEnded
  };
}
