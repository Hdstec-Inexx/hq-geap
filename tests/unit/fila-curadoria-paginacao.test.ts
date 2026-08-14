import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filaCuradoriaSchema,
  filaCuradoriaQuerySchema
} from '../../packages/contracts/src/curadoria.js';
import {
  compactPageItems,
  pageFromSearch,
  resolveFilaPage
} from '../../apps/web/src/features/curadoria/pagination.js';

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

test('resolveFilaPage recua alem de totalPages e pagina 1 vazia permanece 1', () => {
  assert.equal(resolveFilaPage(1, 0), 1);
  assert.equal(resolveFilaPage(3, 0), 1);
  assert.equal(resolveFilaPage(3, 100), 2);
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
