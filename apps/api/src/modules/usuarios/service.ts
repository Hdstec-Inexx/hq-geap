import type { CreateUsuario, Usuario } from '@hq-geap/contracts/usuarios';
import { hash } from 'bcryptjs';
import type { UsuarioRow, UsuariosRepository } from './repository.js';

export function toUsuario(row: UsuarioRow): Usuario {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function createUsuario(
  repository: UsuariosRepository,
  input: CreateUsuario
) {
  const passwordHash = await hash(input.password, 10);
  return repository.create({ ...input, passwordHash });
}

export function isDuplicateEmail(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
