import type pg from 'pg';
import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';

type ChecklistItem = {
  chave: string;
  nome: string;
  estado: EstadoCriterio;
  valor: string;
  critico: boolean;
  ordem: number;
};

export type AvaliacaoIaRow = {
  id: string;
  atendimentoId: string;
  nota: string;
  falhasIdentificadas: unknown;
  resumoAtendimento: string | null;
  promptVersao: number;
  criadoEm: Date;
  checklist: ChecklistItem[];
};

export type AvaliacaoCuradorResumoRow = {
  id: string;
  atendimentoId: string;
  autorId: string;
  autorNome: string;
  nota: string;
  criadoEm: Date;
  checklist: ChecklistItem[];
};

async function findChecklist(
  db: pg.Pool,
  avaliacaoId: string
): Promise<ChecklistItem[]> {
  const checklist = await db.query<ChecklistItem>(`
    select
      ac.criterio_chave as chave,
      ac.criterio_nome as nome,
      ac.estado,
      ac.valor_criterio as valor,
      ac.criterio_critico as critico,
      ac.criterio_ordem as ordem
    from avaliacao_criterios ac
    where ac.avaliacao_id = $1
    order by ac.criterio_ordem
  `, [avaliacaoId]);
  return checklist.rows;
}

export function createAvaliacoesRepository(db: pg.Pool) {
  return {
    async findIaByAtendimentoId(
      atendimentoId: string
    ): Promise<AvaliacaoIaRow | null> {
      const avaliacao = await db.query<Omit<AvaliacaoIaRow, 'checklist'>>(`
        select
          a.id,
          a.atendimento_id as "atendimentoId",
          a.nota,
          a.falhas_identificadas as "falhasIdentificadas",
          a.resumo_atendimento as "resumoAtendimento",
          p.versao as "promptVersao",
          a.criado_em as "criadoEm"
        from avaliacoes a
        join prompts_ia_avaliadora p on p.id = a.prompt_id
        where a.atendimento_id = $1 and a.autor = 'ia'
      `, [atendimentoId]);
      const row = avaliacao.rows[0];
      if (!row) {
        return null;
      }

      return { ...row, checklist: await findChecklist(db, row.id) };
    },

    async findLatestCuradorByAtendimentoId(
      atendimentoId: string
    ): Promise<AvaliacaoCuradorResumoRow | null> {
      const avaliacao = await db.query<Omit<AvaliacaoCuradorResumoRow, 'checklist'>>(`
        select
          a.id,
          a.atendimento_id as "atendimentoId",
          a.autor_usuario_id as "autorId",
          a.autor_usuario_nome as "autorNome",
          a.nota,
          a.criado_em as "criadoEm"
        from avaliacoes a
        where a.atendimento_id = $1 and a.autor = 'curador'
        order by a.criado_em desc, a.id desc
        limit 1
      `, [atendimentoId]);
      const row = avaliacao.rows[0];
      if (!row) {
        return null;
      }

      return { ...row, checklist: await findChecklist(db, row.id) };
    }
  };
}
