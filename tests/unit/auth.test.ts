import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loginResponseSchema,
  perfilSchema,
  sessionIdentitySchema
} from '../../packages/contracts/src/auth.js';

const userId = '11111111-1111-4111-8111-111111111111';

test('sessao magra aceita apenas identidade opaca', () => {
  assert.deepEqual(sessionIdentitySchema.parse({ id: userId }), { id: userId });
  assert.equal(
    sessionIdentitySchema.safeParse({
      id: userId,
      name: 'Ana Admin',
      email: 'admin@hq.test',
      role: 'admin'
    }).success,
    false
  );
  assert.equal(
    loginResponseSchema.safeParse({
      token: 'token',
      user: {
        id: userId,
        name: 'Ana Admin',
        email: 'admin@hq.test',
        role: 'admin'
      }
    }).success,
    false
  );
  assert.deepEqual(
    loginResponseSchema.parse({
      token: 'token',
      user: { id: userId }
    }),
    {
      token: 'token',
      user: { id: userId }
    }
  );
});

test('Perfil exige id, name, email e role', () => {
  assert.deepEqual(
    perfilSchema.parse({
      id: userId,
      name: 'Ana Admin',
      email: 'admin@hq.test',
      role: 'admin'
    }),
    {
      id: userId,
      name: 'Ana Admin',
      email: 'admin@hq.test',
      role: 'admin'
    }
  );
  assert.equal(
    perfilSchema.safeParse({ id: userId }).success,
    false
  );
});
