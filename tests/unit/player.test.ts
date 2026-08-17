import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampSeekTime,
  formatPlayerTime,
  getActiveTurnIndex
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
