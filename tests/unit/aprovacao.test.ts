import assert from 'node:assert/strict';
import test from 'node:test';
import { derivarAprovacao } from '../../apps/api/src/modules/avaliacoes/aprovacao.js';

test('aprova nota maior ou igual a sete sem Falha Critica', () => {
  assert.equal(
    derivarAprovacao(7, [
      { critico: true, estado: 'atendido' },
      { critico: false, estado: 'nao_atendido' }
    ]),
    'aprovado'
  );
});

test('Falha Critica reprova mesmo com nota maior ou igual a sete', () => {
  assert.equal(
    derivarAprovacao(9, [{ critico: true, estado: 'nao_atendido' }]),
    'reprovado'
  );
});

test('Nao se aplica nao caracteriza Falha Critica', () => {
  assert.equal(
    derivarAprovacao(10, [{ critico: true, estado: 'nao_se_aplica' }]),
    'aprovado'
  );
});
