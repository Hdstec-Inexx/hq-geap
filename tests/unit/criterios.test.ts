import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reguaAvaliacaoSchema } from '../../packages/contracts/src/criterios.js';

const reguaValida = {
  vigente: true,
  total: 10,
  limiarAprovacao: 7,
  criterios: [
    {
      chave: 'saudacao',
      nome: 'Saudação',
      descricao: 'Cumprimentou o cliente?',
      valor: 4,
      critico: false,
      condicional: false,
      ordem: 1
    },
    {
      chave: 'resolucao',
      nome: 'Resolução',
      descricao: null,
      valor: 6,
      critico: true,
      condicional: true,
      ordem: 2
    }
  ]
};

test('aceita uma Regua vigente ordenada que soma exatamente 10', () => {
  assert.equal(reguaAvaliacaoSchema.safeParse(reguaValida).success, true);
});

test('rejeita uma Regua cuja soma nao seja exatamente 10', () => {
  assert.equal(
    reguaAvaliacaoSchema.safeParse({
      ...reguaValida,
      criterios: reguaValida.criterios.map((criterio, index) =>
        index === 0 ? { ...criterio, valor: 3.99 } : criterio
      )
    }).success,
    false
  );
});

test('rejeita criterios fora de ordem ou com ordem repetida', () => {
  assert.equal(
    reguaAvaliacaoSchema.safeParse({
      ...reguaValida,
      criterios: [reguaValida.criterios[1], reguaValida.criterios[0]]
    }).success,
    false
  );
  assert.equal(
    reguaAvaliacaoSchema.safeParse({
      ...reguaValida,
      criterios: reguaValida.criterios.map((criterio) => ({
        ...criterio,
        ordem: 1
      }))
    }).success,
    false
  );
});
