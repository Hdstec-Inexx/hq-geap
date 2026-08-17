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

export function getActiveTurnIndex(
  transcricao: Array<{ time_in_call_secs: number }>,
  currentTime: number
): number {
  if (!transcricao || transcricao.length === 0) {
    return -1;
  }

  let activeIndex = -1;
  let maxTime = -1;

  for (let i = 0; i < transcricao.length; i++) {
    const turnTime = transcricao[i]?.time_in_call_secs ?? 0;
    if (turnTime <= currentTime) {
      if (turnTime >= maxTime) {
        maxTime = turnTime;
        activeIndex = i;
      }
    }
  }

  return activeIndex;
}
