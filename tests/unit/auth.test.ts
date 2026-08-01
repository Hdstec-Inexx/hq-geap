import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loginResponseSchema,
  perfilSchema,
  sessionIdentitySchema
} from '../../packages/contracts/src/auth.js';
import {
  passwordVersionClaim,
  sessionMatchesPasswordVersion,
  toSessionTokenClaims
} from '../../apps/api/src/modules/auth/service.js';
import type { AuthUser } from '../../apps/api/src/modules/auth/repository.js';

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

test('token antigo falha apos bump de senha_versao', () => {
  const user: AuthUser = {
    id: userId,
    name: 'Ana Admin',
    email: 'admin@hq.test',
    role: 'admin',
    passwordHash: 'hash',
    passwordVersion: 2
  };
  const claims = toSessionTokenClaims({ ...user, passwordVersion: 1 });
  assert.equal(claims[passwordVersionClaim], 1);
  assert.equal(sessionMatchesPasswordVersion(claims, user.passwordVersion), false);
  assert.equal(
    sessionMatchesPasswordVersion(toSessionTokenClaims(user), user.passwordVersion),
    true
  );
  assert.equal(sessionMatchesPasswordVersion({ sub: userId }, 0), true);
});
