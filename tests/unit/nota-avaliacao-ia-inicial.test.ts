import assert from 'node:assert/strict';
import test from 'node:test';
import { valorInicialNotaAvaliacaoIa } from '../../apps/web/src/features/curadoria/nota-avaliacao-ia-inicial.js';

test('pré-preenche o campo Nota da Avaliação da IA com a nota da Régua da IA', () => {
  assert.equal(valorInicialNotaAvaliacaoIa(9.5), '9.5');
});

test('usa ponto decimal para o input numérico, não vírgula de pt-BR', () => {
  assert.equal(valorInicialNotaAvaliacaoIa(9.5).includes(','), false);
});
