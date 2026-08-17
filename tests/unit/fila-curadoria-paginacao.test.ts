import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filaCuradoriaSchema,
  filaCuradoriaQuerySchema
} from '../../packages/contracts/src/curadoria.js';
import {
  compactPageItems,
  filaHref,
  pageFromSearch,
  resolveFilaPage,
  reviewHref
} from '../../apps/web/src/features/curadoria/pagination.js';
import { motivosAtendimentosSchema } from '../../packages/contracts/src/atendimentos.js';

test('GET /curadoria usa envelope com items e total, nao um array solto', () => {
  assert.equal(filaCuradoriaSchema.safeParse([]).success, false);
  assert.deepEqual(filaCuradoriaSchema.parse({ items: [], total: 0 }), {
    items: [],
    total: 0
  });
});

test('limit/offset da Fila de Curadoria padrao 50 e rejeitam pagina alem do teto', () => {
  assert.deepEqual(filaCuradoriaQuerySchema.parse({}), {
    limit: 50,
    offset: 0
  });
  assert.equal(
    filaCuradoriaQuerySchema.safeParse({ limit: 101 }).success,
    false
  );
  assert.equal(
    filaCuradoriaQuerySchema.safeParse({ offset: 10_001 }).success,
    false
  );
});

test('query da Fila de Curadoria aceita dia unico com default fim=inicio e periodo', () => {
  assert.deepEqual(
    filaCuradoriaQuerySchema.parse({ inicio: '2024-01-15' }),
    {
      limit: 50,
      offset: 0,
      inicio: '2024-01-15',
      fim: '2024-01-15'
    }
  );

  assert.deepEqual(
    filaCuradoriaQuerySchema.parse({
      inicio: '2024-01-01',
      fim: '2024-01-15',
      motivo: '  Rede credenciada  '
    }),
    {
      limit: 50,
      offset: 0,
      inicio: '2024-01-01',
      fim: '2024-01-15',
      motivo: 'Rede credenciada'
    }
  );

  assert.deepEqual(
    filaCuradoriaQuerySchema.parse({ motivo: 'Financeiro/Boletos' }),
    {
      limit: 50,
      offset: 0,
      motivo: 'Financeiro/Boletos'
    }
  );
});

test('query da Fila de Curadoria valida consistencia de datas e fuso', () => {
  assert.equal(
    filaCuradoriaQuerySchema.safeParse({ fim: '2024-01-15' }).success,
    false
  );
  assert.equal(
    filaCuradoriaQuerySchema.safeParse({
      inicio: '2024-01-20',
      fim: '2024-01-10'
    }).success,
    false
  );
  assert.equal(
    filaCuradoriaQuerySchema.safeParse({
      inicio: '2024-01-01',
      fim: '2025-01-02'
    }).success,
    false
  );
  assert.equal(
    filaCuradoriaQuerySchema.safeParse({ inicio: 'data-invalida' }).success,
    false
  );
});

test('contrato de motivos de Atendimentos valida array de strings', () => {
  assert.deepEqual(
    motivosAtendimentosSchema.parse(['Cancelamento', 'Financeiro/Boletos']),
    ['Cancelamento', 'Financeiro/Boletos']
  );
  assert.equal(motivosAtendimentosSchema.safeParse('string-solta').success, false);
  assert.equal(motivosAtendimentosSchema.safeParse([123]).success, false);
});

test('filaHref e reviewHref preservam searchParams com filtros', () => {
  const params = new URLSearchParams('page=2&inicio=2024-01-01&fim=2024-01-15&motivo=Rede');
  assert.equal(
    filaHref(params),
    '/curadoria?page=2&inicio=2024-01-01&fim=2024-01-15&motivo=Rede'
  );
  assert.equal(
    filaHref(params, 1),
    '/curadoria?inicio=2024-01-01&fim=2024-01-15&motivo=Rede'
  );
  assert.equal(
    reviewHref('11111111-1111-1111-1111-111111111111', params),
    '/curadoria/11111111-1111-1111-1111-111111111111?page=2&inicio=2024-01-01&fim=2024-01-15&motivo=Rede'
  );
});

test('resolveFilaPage recua alem de totalPages e pagina 1 vazia permanece 1', () => {
  assert.equal(resolveFilaPage(1, 0), 1);
  assert.equal(resolveFilaPage(3, 0), 1);
  assert.equal(resolveFilaPage(3, 100), 2);
  assert.equal(resolveFilaPage(3, 101, 0), 2);
  assert.equal(resolveFilaPage(999, 51, 0), 2);
  assert.equal(resolveFilaPage(2, 51), 2);
  assert.equal(resolveFilaPage(0, 51), 1);
  assert.equal(resolveFilaPage(999, 51), 2);
});

test('page da URL nao envia offset alem do teto da API', () => {
  assert.equal(pageFromSearch(new URLSearchParams('page=999')), 201);
  assert.equal(pageFromSearch(new URLSearchParams('page=2')), 2);
  assert.equal(pageFromSearch(new URLSearchParams()), 1);
});

test('pager compacto mostra 1, ultima e vizinhança da atual — sem faixa ilimitada', () => {
  assert.deepEqual(compactPageItems(1, 3), [1, 2, 3]);
  assert.deepEqual(compactPageItems(1, 20), [1, 2, 3, 'ellipsis', 20]);
  assert.deepEqual(compactPageItems(10, 20), [
    1,
    'ellipsis',
    9,
    10,
    11,
    'ellipsis',
    20
  ]);
  assert.deepEqual(compactPageItems(20, 20), [1, 'ellipsis', 18, 19, 20]);
});
