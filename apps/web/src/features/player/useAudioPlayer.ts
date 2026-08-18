import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, SyntheticEvent } from 'react';
import {
  clampSeekTime,
  getNextPlaybackRate,
  getStoredPlaybackRate,
  parsePlaybackRate,
  setStoredPlaybackRate,
  type PlaybackRate
} from './audio-player-logic';

export interface UseAudioPlayerOptions {
  audioUrl?: string | null;
  durationSeconds?: number | null;
  initialPlaybackRate?: PlaybackRate;
  storage?: Storage;
}

export interface AudioPlayerController {
  audioRef: RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  hasEnded: boolean;
  playbackRate: PlaybackRate;
  setPlaybackRate: (rate: number | PlaybackRate) => void;
  cyclePlaybackRate: () => void;
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
  durationSeconds,
  initialPlaybackRate,
  storage
}: UseAudioPlayerOptions): AudioPlayerController {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(() => durationSeconds ?? 0);
  const [hasEnded, setHasEnded] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(() => {
    if (initialPlaybackRate !== undefined) {
      return parsePlaybackRate(initialPlaybackRate);
    }
    return getStoredPlaybackRate(storage);
  });

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

  // Keep audio element's playbackRate in sync whenever audio element or rate changes
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [audioUrl, playbackRate]);

  const setPlaybackRate = useCallback(
    (rate: number | PlaybackRate) => {
      const validRate = parsePlaybackRate(rate);
      setPlaybackRateState(validRate);
      if (audioRef.current) {
        audioRef.current.playbackRate = validRate;
      }
      setStoredPlaybackRate(validRate, storage);
    },
    [storage]
  );

  const cyclePlaybackRate = useCallback(() => {
    const nextRate = getNextPlaybackRate(playbackRate);
    setPlaybackRate(nextRate);
  }, [playbackRate, setPlaybackRate]);

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

  const handleLoadedMetadata = useCallback(
    (e: SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget;
      audio.playbackRate = playbackRate;
      if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    },
    [playbackRate]
  );

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
    playbackRate,
    setPlaybackRate,
    cyclePlaybackRate,
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
