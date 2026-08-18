import {
  formatPlaybackRate,
  PLAYBACK_RATES,
  type PlaybackRate
} from './audio-player-logic';

export interface PlaybackSpeedControlProps {
  playbackRate: PlaybackRate;
  onCycle: () => void;
  onSelect: (rate: PlaybackRate | number) => void;
  variant?: 'main' | 'mini';
}

export function PlaybackSpeedControl({
  playbackRate,
  onCycle,
  onSelect,
  variant = 'main'
}: PlaybackSpeedControlProps) {
  const isMini = variant === 'mini';
  const containerClass = isMini ? 'miniplayer-speed' : 'audio-player-speed';
  const btnClass = isMini ? 'miniplayer-btn miniplayer-speed-btn' : 'audio-player-btn audio-speed-btn';
  const selectClass = isMini ? 'miniplayer-speed-select' : 'audio-speed-select';
  const testIdPrefix = isMini ? 'miniplayer' : 'audio';

  return (
    <div className={containerClass} data-testid={`${testIdPrefix}-speed-control`}>
      <button
        type="button"
        className={btnClass}
        data-testid={`${testIdPrefix}-speed-btn`}
        onClick={onCycle}
        aria-label={`Velocidade de reprodução: ${formatPlaybackRate(playbackRate)}. Clique para alternar.`}
        title="Ciclar velocidade de reprodução"
      >
        {formatPlaybackRate(playbackRate)}
      </button>
      <select
        className={selectClass}
        data-testid={`${testIdPrefix}-speed-select`}
        value={playbackRate}
        onChange={(e) => onSelect(Number(e.target.value))}
        aria-label="Selecionar velocidade de reprodução"
        title="Selecionar velocidade de reprodução"
      >
        {PLAYBACK_RATES.map((rate) => (
          <option key={rate} value={rate}>
            {formatPlaybackRate(rate)}
          </option>
        ))}
      </select>
    </div>
  );
}
