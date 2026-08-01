import type {
  CreateUsuario,
  SetUsuarioPassword,
  Usuario
} from '@hq-geap/contracts/usuarios';
import { hash } from 'bcryptjs';
import type { UsuarioRow, UsuariosRepository } from './repository.js';

const passwordHashRounds = 10;

async function hashPassword(password: string) {
  return hash(password, passwordHashRounds);
}

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
  const passwordHash = await hashPassword(input.password);
  return repository.create({ ...input, passwordHash });
}

export async function setUsuarioPassword(
  repository: UsuariosRepository,
  id: string,
  input: SetUsuarioPassword
) {
  const passwordHash = await hashPassword(input.password);
  return repository.setPassword(id, passwordHash);
}

export function isDuplicateEmail(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
