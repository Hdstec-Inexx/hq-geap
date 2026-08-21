import type pg from 'pg';

export type CriterioRow = {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  valor: string;
  critico: boolean;
  condicional: boolean;
  ordem: number;
};

export function createCriteriosRepository(db: pg.Pool) {
  return {
    async findVigentes(): Promise<CriterioRow[]> {
      const result = await db.query<CriterioRow>(`
        select id, chave, nome, descricao, valor, critico, condicional, ordem
        from criterios
        where ativo
        order by ordem
      `);
      return result.rows;
    }
  };
}
