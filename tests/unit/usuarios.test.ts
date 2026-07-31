import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUsuarioSchema,
  listUsuariosQuerySchema
} from '../../packages/contracts/src/usuarios.js';

const validUser = {
  name: 'Pessoa de teste',
  email: 'pessoa@hq.test',
  role: 'curador' as const
};

test('rejeita senha que excede o limite de 72 bytes do bcrypt', () => {
  const password = 'á'.repeat(37);

  assert.equal(password.length, 37);
  assert.equal(new TextEncoder().encode(password).length, 74);
  assert.equal(
    createUsuarioSchema.safeParse({ ...validUser, password }).success,
    false
  );
});

test('aceita senha com exatamente 72 bytes', () => {
  assert.equal(
    createUsuarioSchema.safeParse({
      ...validUser,
      password: 'a'.repeat(72)
    }).success,
    true
  );
});

test('aplica paginacao padrao e limita o tamanho maximo da pagina', () => {
  assert.deepEqual(listUsuariosQuerySchema.parse({}), {
    page: 1,
    pageSize: 20
  });
  assert.equal(
    listUsuariosQuerySchema.safeParse({ page: 1, pageSize: 101 }).success,
    false
  );
});
