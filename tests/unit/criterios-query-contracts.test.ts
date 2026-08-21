import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atendimentosQuerySchema } from '../../packages/contracts/src/atendimentos.js';
import { curadoriasRealizadasQuerySchema } from '../../packages/contracts/src/curadoria.js';

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

test('atendimentosQuerySchema aceita criteriosNaoAtendidos e criteriosAtendidos como array ou string separada por virgula', () => {
  const result1 = atendimentosQuerySchema.safeParse({
    criteriosNaoAtendidos: UUID_1,
    criteriosAtendidos: `${UUID_2},${UUID_3}`
  });
  assert.equal(result1.success, true);
  if (result1.success) {
    assert.deepEqual(result1.data.criteriosNaoAtendidos, [UUID_1]);
    assert.deepEqual(result1.data.criteriosAtendidos, [UUID_2, UUID_3]);
  }

  const result2 = atendimentosQuerySchema.safeParse({
    criteriosNaoAtendidos: [UUID_1, UUID_2],
    criteriosAtendidos: [UUID_3]
  });
  assert.equal(result2.success, true);
  if (result2.success) {
    assert.deepEqual(result2.data.criteriosNaoAtendidos, [UUID_1, UUID_2]);
    assert.deepEqual(result2.data.criteriosAtendidos, [UUID_3]);
  }
});

test('atendimentosQuerySchema normaliza duplicatas e espacos vazios', () => {
  const result = atendimentosQuerySchema.safeParse({
    criteriosNaoAtendidos: `  ${UUID_1} , ${UUID_1} `,
    criteriosAtendidos: ''
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.criteriosNaoAtendidos, [UUID_1]);
    assert.equal(result.data.criteriosAtendidos, undefined);
  }
});

test('atendimentosQuerySchema rejeita criterios com UUID invalido', () => {
  const result = atendimentosQuerySchema.safeParse({
    criteriosNaoAtendidos: 'not-a-uuid'
  });
  assert.equal(result.success, false);
});

test('curadoriasRealizadasQuerySchema aceita criteriosNaoAtendidos e criteriosAtendidos', () => {
  const result = curadoriasRealizadasQuerySchema.safeParse({
    criteriosNaoAtendidos: [UUID_1, UUID_2],
    criteriosAtendidos: `${UUID_3}`
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.criteriosNaoAtendidos, [UUID_1, UUID_2]);
    assert.deepEqual(result.data.criteriosAtendidos, [UUID_3]);
  }
});
