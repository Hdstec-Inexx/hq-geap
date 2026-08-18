export const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
export const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1;
export const PLAYBACK_RATE_STORAGE_KEY = 'hq-geap.playback-rate';
const PLAYBACK_RATE_CYCLE_ORDER: readonly PlaybackRate[] = [1, 1.25, 1.5, 2, 0.5];

export function formatPlaybackRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) {
    return '1x';
  }
  return `${rate}x`;
}

export function parsePlaybackRate(value: unknown): PlaybackRate {
  if (typeof value === 'number') {
    if (PLAYBACK_RATES.includes(value as PlaybackRate)) {
      return value as PlaybackRate;
    }
  } else if (typeof value === 'string') {
    const num = Number(value);
    if (!Number.isNaN(num) && PLAYBACK_RATES.includes(num as PlaybackRate)) {
      return num as PlaybackRate;
    }
  }
  return DEFAULT_PLAYBACK_RATE;
}

export function getNextPlaybackRate(currentRate: number): PlaybackRate {
  const index = PLAYBACK_RATE_CYCLE_ORDER.indexOf(currentRate as PlaybackRate);
  if (index === -1) {
    return DEFAULT_PLAYBACK_RATE;
  }
  return PLAYBACK_RATE_CYCLE_ORDER[(index + 1) % PLAYBACK_RATE_CYCLE_ORDER.length]!;
}

export function getStoredPlaybackRate(storage?: Storage): PlaybackRate {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) {
      return DEFAULT_PLAYBACK_RATE;
    }
    const raw = store.getItem(PLAYBACK_RATE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PLAYBACK_RATE;
    }
    return parsePlaybackRate(raw);
  } catch {
    return DEFAULT_PLAYBACK_RATE;
  }
}

export function setStoredPlaybackRate(rate: PlaybackRate, storage?: Storage): void {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) return;
    const validRate = parsePlaybackRate(rate);
    store.setItem(PLAYBACK_RATE_STORAGE_KEY, String(validRate));
  } catch {
    // Ignore storage write errors (e.g. QuotaExceeded or disabled storage)
  }
}

export function formatPlayerTime(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function clampSeekTime(time: number, duration: number): number {
  if (Number.isNaN(duration) || !Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, time);
  }
  return Math.max(0, Math.min(duration, time));
}

export function extractTurnTime(
  turn:
    | { time_in_call_secs?: number | string | null; tempo_segundos?: number | string | null }
    | null
    | undefined
): number | null {
  if (!turn || typeof turn !== 'object') {
    return null;
  }
  const raw =
    turn.time_in_call_secs !== undefined && turn.time_in_call_secs !== null
      ? turn.time_in_call_secs
      : turn.tempo_segundos;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return 0;
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }
  return null;
}

export function getActiveTurnIndex(
  transcricao: Array<
    | { time_in_call_secs?: number | string | null; tempo_segundos?: number | string | null }
    | null
    | undefined
  >,
  currentTime: number
): number {
  if (!transcricao || transcricao.length === 0 || currentTime < 0) {
    return -1;
  }

  let activeIndex = -1;
  let maxTime = -1;

  for (let i = 0; i < transcricao.length; i++) {
    const turnTime = extractTurnTime(transcricao[i]);
    if (turnTime !== null && turnTime <= currentTime) {
      if (turnTime >= maxTime) {
        maxTime = turnTime;
        activeIndex = i;
      }
    }
  }

  return activeIndex;
}

export function shouldShowMiniplayer(params: {
  isPastMainPlayer: boolean;
  hasEnded?: boolean;
  hasAudioUrl?: boolean;
}): boolean {
  if (!params.hasAudioUrl) {
    return false;
  }
  if (!params.isPastMainPlayer) {
    return false;
  }
  if (params.hasEnded) {
    return false;
  }
  return true;
}
