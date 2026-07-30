import type { UserRole } from '@hq-geap/contracts/auth';
import type pg from 'pg';

export type UsuarioRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const selectUsuario = `
  select
    id,
    nome as name,
    email,
    papel as role,
    ativo as active,
    criado_em as "createdAt",
    atualizado_em as "updatedAt"
  from usuarios
`;

export class LastActiveAdminError extends Error {}

async function protectActiveAdmin(
  client: pg.PoolClient,
  id: string,
  replacementRole: UserRole | null
) {
  await client.query('select pg_advisory_xact_lock(90410)');
  const target = await client.query<{ active: boolean; role: UserRole }>(
    `select ativo as active, papel as role
     from usuarios
     where id = $1
     for update`,
    [id]
  );
  const user = target.rows[0];
  if (!user) return false;

  const removesActiveAdmin =
    user.active && user.role === 'admin' && replacementRole !== 'admin';
  if (removesActiveAdmin) {
    const activeAdmins = await client.query<{ count: string }>(
      `select count(*) as count
       from usuarios
       where ativo and papel = 'admin'`
    );
    if (activeAdmins.rows[0]?.count === '1') {
      throw new LastActiveAdminError('At least one active Admin is required');
    }
  }
  return true;
}

export function createUsuariosRepository(db: pg.Pool) {
  return {
    async list(): Promise<UsuarioRow[]> {
      const result = await db.query<UsuarioRow>(
        `${selectUsuario} order by ativo desc, lower(nome), id`
      );
      return result.rows;
    },

    async create(input: {
      name: string;
      email: string;
      passwordHash: string;
      role: UserRole;
    }): Promise<UsuarioRow> {
      const result = await db.query<UsuarioRow>(
        `insert into usuarios (nome, email, senha_hash, papel)
         values ($1, $2, $3, $4)
         returning id, nome as name, email, papel as role, ativo as active,
           criado_em as "createdAt", atualizado_em as "updatedAt"`,
        [input.name, input.email, input.passwordHash, input.role]
      );
      return result.rows[0]!;
    },

    async update(
      id: string,
      input: { name: string; email: string; role: UserRole }
    ): Promise<UsuarioRow | null> {
      const client = await db.connect();
      try {
        await client.query('begin');
        if (!(await protectActiveAdmin(client, id, input.role))) {
          await client.query('rollback');
          return null;
        }
        const result = await client.query<UsuarioRow>(
          `update usuarios
           set nome = $2, email = $3, papel = $4, atualizado_em = now()
           where id = $1
           returning id, nome as name, email, papel as role, ativo as active,
             criado_em as "createdAt", atualizado_em as "updatedAt"`,
          [id, input.name, input.email, input.role]
        );
        await client.query('commit');
        return result.rows[0] ?? null;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async deactivate(id: string): Promise<UsuarioRow | null> {
      const client = await db.connect();
      try {
        await client.query('begin');
        if (!(await protectActiveAdmin(client, id, null))) {
          await client.query('rollback');
          return null;
        }
        const result = await client.query<UsuarioRow>(
          `update usuarios
           set ativo = false, atualizado_em = now()
           where id = $1
           returning id, nome as name, email, papel as role, ativo as active,
             criado_em as "createdAt", atualizado_em as "updatedAt"`,
          [id]
        );
        await client.query('commit');
        return result.rows[0] ?? null;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export type UsuariosRepository = ReturnType<typeof createUsuariosRepository>;
