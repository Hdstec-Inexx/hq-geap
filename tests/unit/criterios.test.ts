import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  criterioSchema,
  reguaAvaliacaoSchema
} from '../../packages/contracts/src/criterios.js';

const apiRoutesPath = new URL(
  '../../apps/api/src/modules/criterios/routes.ts',
  import.meta.url
);
const routerPath = new URL(
  '../../apps/web/src/app/router.tsx',
  import.meta.url
);
const pagePath = new URL(
  '../../apps/web/src/features/admin/criterios/CriteriosPage.tsx',
  import.meta.url
);

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

test('criterioSchema aceita valor 0', () => {
  assert.equal(
    criterioSchema.safeParse({
      ...reguaValida.criterios[0]!,
      valor: 0
    }).success,
    true
  );
});

test('criterioSchema rejeita valor negativo', () => {
  assert.equal(
    criterioSchema.safeParse({
      ...reguaValida.criterios[0]!,
      valor: -0.01
    }).success,
    false
  );
});

test('aceita Critério com valor 0 quando a Regua continua somando 10', () => {
  assert.equal(
    reguaAvaliacaoSchema.safeParse({
      ...reguaValida,
      criterios: [
        { ...reguaValida.criterios[0]!, valor: 0 },
        { ...reguaValida.criterios[1]!, valor: 10 }
      ]
    }).success,
    true
  );
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

test('API routes de criterios autoriza todos os papeis autenticados (admin, gestao, curador)', async () => {
  const content = await readFile(apiRoutesPath, 'utf8');

  assert.match(content, /\/admin\/criterios/);
  assert.match(content, /roles:\s*\[[^\]]*'admin'[^\]]*'gestao'[^\]]*'curador'[^\]]*\]/);
});

test('router.tsx registra /admin/criterios no nivel da casca autenticada para todos os papeis', async () => {
  const content = await readFile(routerPath, 'utf8');

  assert.match(content, /path:\s*'\/admin\/criterios',\s*element:\s*<CriteriosRoute\s*\/>/);
  // Ensure it's not nested inside RequireRole roles={['admin']}
  const adminSectionMatch = content.match(/RequireRole\s+roles=\{\['admin'\]\}[\s\S]*?<\/RequireRole>|RequireRole\s+roles=\{\['admin'\]\}[\s\S]*?children:\s*\[([\s\S]*?)\]\s*\}/);
  if (adminSectionMatch && adminSectionMatch[1]) {
    assert.doesNotMatch(adminSectionMatch[1], /\/admin\/criterios/);
  }
});

test('CriteriosPage nao exibe mensagem tecnica de rodape sobre snapshots e alteracoes por codigo', async () => {
  const content = await readFile(pagePath, 'utf8');

  assert.doesNotMatch(content, /snapshots de Avaliações anteriores/);
  assert.doesNotMatch(content, /criteria-footnote/);
});
