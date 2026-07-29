import type { PublishConfiguracaoIa } from '@hq-geap/contracts/configuracao-ia';
import type pg from 'pg';

export type ConfiguracaoIaRow = {
  id: string;
  version: number;
  prompt: string;
  provider: string;
  model: string;
  temperature: string;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
};

const selectConfiguracao = `
  select
    id,
    versao as version,
    prompt,
    provedor as provider,
    modelo as model,
    temperatura as temperature,
    ativo as active,
    criado_por as "createdBy",
    criado_em as "createdAt"
  from prompts_ia_avaliadora
`;

export function createConfiguracaoIaRepository(db: pg.Pool) {
  return {
    async findActive(): Promise<ConfiguracaoIaRow | null> {
      const result = await db.query<ConfiguracaoIaRow>(
        `${selectConfiguracao} where ativo limit 1`
      );
      return result.rows[0] ?? null;
    },

    async publish(
      configuration: PublishConfiguracaoIa,
      userId: string
    ): Promise<ConfiguracaoIaRow> {
      const client = await db.connect();
      try {
        await client.query('begin');
        await client.query('lock table prompts_ia_avaliadora in exclusive mode');
        const versionResult = await client.query<{ version: number }>(
          'select coalesce(max(versao), 0) + 1 as version from prompts_ia_avaliadora'
        );
        const version = versionResult.rows[0]!.version;

        await client.query('update prompts_ia_avaliadora set ativo = false where ativo');
        const result = await client.query<ConfiguracaoIaRow>(
          `insert into prompts_ia_avaliadora
             (versao, prompt, provedor, modelo, temperatura, ativo, criado_por)
           values ($1, $2, $3, $4, $5, true, $6)
           returning
             id,
             versao as version,
             prompt,
             provedor as provider,
             modelo as model,
             temperatura as temperature,
             ativo as active,
             criado_por as "createdBy",
             criado_em as "createdAt"`,
          [
            version,
            configuration.prompt,
            configuration.provider,
            configuration.model,
            configuration.temperature,
            userId
          ]
        );
        await client.query('commit');
        return result.rows[0]!;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export type ConfiguracaoIaRepository = ReturnType<
  typeof createConfiguracaoIaRepository
>;
