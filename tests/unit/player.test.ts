import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampSeekTime,
  DEFAULT_PLAYBACK_RATE,
  formatPlaybackRate,
  formatPlayerTime,
  getActiveTurnIndex,
  getNextPlaybackRate,
  getStoredPlaybackRate,
  parsePlaybackRate,
  PLAYBACK_RATE_STORAGE_KEY,
  PLAYBACK_RATES,
  setStoredPlaybackRate,
  shouldShowMiniplayer
} from '../../apps/web/src/features/player/audio-player-logic.js';

test('formatPlayerTime formata segundos em mm:ss e hh:mm:ss', () => {
  assert.equal(formatPlayerTime(0), '00:00');
  assert.equal(formatPlayerTime(5), '00:05');
  assert.equal(formatPlayerTime(45), '00:45');
  assert.equal(formatPlayerTime(60), '01:00');
  assert.equal(formatPlayerTime(75), '01:15');
  assert.equal(formatPlayerTime(600), '10:00');
  assert.equal(formatPlayerTime(3600), '1:00:00');
  assert.equal(formatPlayerTime(3665), '1:01:05');
  assert.equal(formatPlayerTime(null), '00:00');
  assert.equal(formatPlayerTime(undefined), '00:00');
  assert.equal(formatPlayerTime(-10), '00:00');
  assert.equal(formatPlayerTime(Number.NaN), '00:00');
});

test('clampSeekTime restringe o seek aos limites [0, duracao]', () => {
  assert.equal(clampSeekTime(-10, 100), 0);
  assert.equal(clampSeekTime(0, 100), 0);
  assert.equal(clampSeekTime(50, 100), 50);
  assert.equal(clampSeekTime(100, 100), 100);
  assert.equal(clampSeekTime(110, 100), 100);
  assert.equal(clampSeekTime(20, 0), 20); // permite antes dos metadados carregarem
  assert.equal(clampSeekTime(20, -5), 20);
  assert.equal(clampSeekTime(-5, 0), 0);
  assert.equal(clampSeekTime(20, Number.NaN), 20);
});

test('getActiveTurnIndex encontra o ultimo turno cujo time_in_call_secs <= posicao do audio', () => {
  const turns = [
    { role: 'agent' as const, message: 'Olá!', time_in_call_secs: 0 },
    { role: 'user' as const, message: 'Preciso de boleto', time_in_call_secs: 10 },
    { role: 'agent' as const, message: '', time_in_call_secs: 20 }, // tool_call vazia
    { role: 'agent' as const, message: 'Aqui está seu boleto.', time_in_call_secs: 25 },
    { role: 'user' as const, message: 'Obrigado', time_in_call_secs: 40 }
  ];

  assert.equal(getActiveTurnIndex([], 10), -1);
  assert.equal(getActiveTurnIndex(turns, 0), 0);
  assert.equal(getActiveTurnIndex(turns, 5), 0);
  assert.equal(getActiveTurnIndex(turns, 9.9), 0);
  assert.equal(getActiveTurnIndex(turns, 10), 1);
  assert.equal(getActiveTurnIndex(turns, 15), 1);
  assert.equal(getActiveTurnIndex(turns, 20), 2); // tool_call vazia participa da sincronia
  assert.equal(getActiveTurnIndex(turns, 24.9), 2);
  assert.equal(getActiveTurnIndex(turns, 25), 3);
  assert.equal(getActiveTurnIndex(turns, 39.9), 3);
  assert.equal(getActiveTurnIndex(turns, 40), 4);
  assert.equal(getActiveTurnIndex(turns, 60), 4);
});

test('getActiveTurnIndex retorna -1 quando o primeiro turno inicia apos currentTime', () => {
  const turns = [
    { role: 'agent' as const, message: 'Aguarde um momento', time_in_call_secs: 5 },
    { role: 'user' as const, message: 'Estou aguardando', time_in_call_secs: 15 }
  ];

  assert.equal(getActiveTurnIndex(turns, 0), -1);
  assert.equal(getActiveTurnIndex(turns, 4.9), -1);
  assert.equal(getActiveTurnIndex(turns, 5), 0);
  assert.equal(getActiveTurnIndex(turns, 10), 0);
});

test('getActiveTurnIndex tolera turnos nao ordenados cronologicamente', () => {
  const unsorted = [
    { role: 'agent' as const, message: 'Turno 25s', time_in_call_secs: 25 },
    { role: 'agent' as const, message: 'Turno 0s', time_in_call_secs: 0 },
    { role: 'user' as const, message: 'Turno 10s', time_in_call_secs: 10 }
  ];

  assert.equal(getActiveTurnIndex(unsorted, 5), 1); // 0s
  assert.equal(getActiveTurnIndex(unsorted, 12), 2); // 10s
  assert.equal(getActiveTurnIndex(unsorted, 30), 0); // 25s
});

test('shouldShowMiniplayer requer audioUrl, scroll alem do player e audio nao finalizado', () => {
  assert.equal(
    shouldShowMiniplayer({
      isPastMainPlayer: true,
      hasEnded: false,
      hasAudioUrl: true
    }),
    true
  );

  // Sem audioUrl
  assert.equal(
    shouldShowMiniplayer({
      isPastMainPlayer: true,
      hasEnded: false,
      hasAudioUrl: false
    }),
    false
  );

  // Player principal ainda visivel no viewport
  assert.equal(
    shouldShowMiniplayer({
      isPastMainPlayer: false,
      hasEnded: false,
      hasAudioUrl: true
    }),
    false
  );

  // Audio finalizado
  assert.equal(
    shouldShowMiniplayer({
      isPastMainPlayer: true,
      hasEnded: true,
      hasAudioUrl: true
    }),
    false
  );
});

test('PLAYBACK_RATES contem a escala classica [0.5, 1, 1.25, 1.5, 2] com default 1', () => {
  assert.deepEqual(PLAYBACK_RATES, [0.5, 1, 1.25, 1.5, 2]);
  assert.equal(DEFAULT_PLAYBACK_RATE, 1);
});

test('formatPlaybackRate formata a taxa com sufixo x e trata valores invalidos', () => {
  assert.equal(formatPlaybackRate(0.5), '0.5x');
  assert.equal(formatPlaybackRate(1), '1x');
  assert.equal(formatPlaybackRate(1.25), '1.25x');
  assert.equal(formatPlaybackRate(1.5), '1.5x');
  assert.equal(formatPlaybackRate(2), '2x');
  assert.equal(formatPlaybackRate(Number.NaN), '1x');
  assert.equal(formatPlaybackRate(null as unknown as number), '1x');
  assert.equal(formatPlaybackRate(undefined as unknown as number), '1x');
});

test('getNextPlaybackRate cicla na ordem [1 -> 1.25 -> 1.5 -> 2 -> 0.5 -> 1]', () => {
  assert.equal(getNextPlaybackRate(1), 1.25);
  assert.equal(getNextPlaybackRate(1.25), 1.5);
  assert.equal(getNextPlaybackRate(1.5), 2);
  assert.equal(getNextPlaybackRate(2), 0.5);
  assert.equal(getNextPlaybackRate(0.5), 1);

  // Valores fora da escala ou invalidos recaem com seguranca para o default ou proximo
  assert.equal(getNextPlaybackRate(0), 1);
  assert.equal(getNextPlaybackRate(3), 1);
  assert.equal(getNextPlaybackRate(Number.NaN), 1);
  assert.equal(getNextPlaybackRate(null as unknown as number), 1);
});

test('parsePlaybackRate valida escala permitida e recai para DEFAULT_PLAYBACK_RATE em invalidos', () => {
  assert.equal(parsePlaybackRate(0.5), 0.5);
  assert.equal(parsePlaybackRate(1), 1);
  assert.equal(parsePlaybackRate(1.25), 1.25);
  assert.equal(parsePlaybackRate(1.5), 1.5);
  assert.equal(parsePlaybackRate(2), 2);

  // Strings numericas validas
  assert.equal(parsePlaybackRate('0.5'), 0.5);
  assert.equal(parsePlaybackRate('1'), 1);
  assert.equal(parsePlaybackRate('1.25'), 1.25);
  assert.equal(parsePlaybackRate('1.5'), 1.5);
  assert.equal(parsePlaybackRate('2'), 2);

  // Invalidos
  assert.equal(parsePlaybackRate(0), 1);
  assert.equal(parsePlaybackRate(0.75), 1);
  assert.equal(parsePlaybackRate(3), 1);
  assert.equal(parsePlaybackRate(-1), 1);
  assert.equal(parsePlaybackRate('abc'), 1);
  assert.equal(parsePlaybackRate(null), 1);
  assert.equal(parsePlaybackRate(undefined), 1);
  assert.equal(parsePlaybackRate(Number.NaN), 1);
});

test('getStoredPlaybackRate e setStoredPlaybackRate persistem e restauram no localStorage', () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    }
  } as Storage;

  // Sem nada salvo -> default 1
  assert.equal(getStoredPlaybackRate(mockStorage), 1);

  // Salva 1.5 -> restaura 1.5
  setStoredPlaybackRate(1.5, mockStorage);
  assert.equal(store.get(PLAYBACK_RATE_STORAGE_KEY), '1.5');
  assert.equal(getStoredPlaybackRate(mockStorage), 1.5);

  // Salva 2 -> restaura 2
  setStoredPlaybackRate(2, mockStorage);
  assert.equal(store.get(PLAYBACK_RATE_STORAGE_KEY), '2');
  assert.equal(getStoredPlaybackRate(mockStorage), 2);

  // Valor invalido corrompido no storage -> fallback para default 1
  store.set(PLAYBACK_RATE_STORAGE_KEY, 'invalid-rate');
  assert.equal(getStoredPlaybackRate(mockStorage), 1);

  // Storage que lanca excecao (ex: storage desabilitado/privacidade) -> fallback para default 1
  const failingStorage = {
    getItem: () => {
      throw new Error('Access denied');
    },
    setItem: () => {
      throw new Error('Quota exceeded');
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0
  } as unknown as Storage;

  assert.equal(getStoredPlaybackRate(failingStorage), 1);
  assert.doesNotThrow(() => setStoredPlaybackRate(1.25, failingStorage));
});
