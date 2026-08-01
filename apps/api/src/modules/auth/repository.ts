import type { Perfil, UserRole } from '@hq-geap/contracts/auth';
import type pg from 'pg';

type UserRow = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordVersion: number;
  role: UserRole;
};

export type AuthUser = Perfil & {
  passwordHash: string;
  passwordVersion: number;
};

const selectUser = `
  select
    id,
    nome as name,
    email,
    senha_hash as "passwordHash",
    senha_versao as "passwordVersion",
    papel as role
  from usuarios
`;

export function createAuthRepository(db: pg.Pool) {
  return {
    async findActiveByEmail(email: string): Promise<AuthUser | null> {
      const result = await db.query<UserRow>(
        `${selectUser} where ativo and lower(email) = lower($1) limit 1`,
        [email.trim()]
      );
      return result.rows[0] ?? null;
    },

    async findActiveById(id: string): Promise<AuthUser | null> {
      const result = await db.query<UserRow>(
        `${selectUser} where ativo and id = $1 limit 1`,
        [id]
      );
      return result.rows[0] ?? null;
    }
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
