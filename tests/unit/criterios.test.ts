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

test('aceita Criterio com valor 0 e Regua que ainda soma 10', () => {
  const reguaComValorZero = {
    ...reguaValida,
    criterios: [
      ...reguaValida.criterios.map((criterio, index) =>
        index === 0 ? { ...criterio, valor: 4 } : criterio
      ),
      {
        chave: 'uso_correto_ferramentas',
        nome: 'Uso Correto de Ferramentas',
        descricao: 'Acionou as ferramentas corretas sem uso indevido?',
        valor: 0,
        critico: false,
        condicional: false,
        ordem: 3
      }
    ]
  };

  assert.equal(reguaAvaliacaoSchema.safeParse(reguaComValorZero).success, true);
});

test('rejeita Criterio com valor negativo', () => {
  assert.equal(
    reguaAvaliacaoSchema.safeParse({
      ...reguaValida,
      criterios: [
        { ...reguaValida.criterios[0]!, valor: -0.01 },
        { ...reguaValida.criterios[1]!, valor: 10.01 }
      ]
    }).success,
    false
  );
});
