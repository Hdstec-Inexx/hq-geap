import type pg from 'pg';
import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';

export type AvaliacaoIaRow = {
  id: string;
  atendimentoId: string;
  nota: string;
  falhasIdentificadas: unknown;
  resumoAtendimento: string | null;
  promptVersao: number;
  criadoEm: Date;
  checklist: Array<{
    chave: string;
    nome: string;
    estado: EstadoCriterio;
    valor: string;
    critico: boolean;
    ordem: number;
  }>;
};

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

      const checklist = await db.query<AvaliacaoIaRow['checklist'][number]>(`
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
      `, [row.id]);

      return { ...row, checklist: checklist.rows };
    }
  };
}
