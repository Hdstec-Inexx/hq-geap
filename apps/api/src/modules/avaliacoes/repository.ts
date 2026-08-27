import type pg from 'pg';
import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';

type ChecklistItem = {
  chave: string;
  nome: string;
  descricao?: string | null;
  estado: EstadoCriterio;
  valor: string;
  critico: boolean;
  ordem: number;
};

export type AvaliacaoIaRow = {
  id: string;
  atendimentoId: string;
  nota: string;
  notaQualidade: string;
  atendimentoAprovado: boolean;
  falhasIdentificadas: unknown;
  resumoAtendimento: string | null;
  promptVersao: number;
  criadoEm: Date;
  saudacaoEIntencao: boolean;
  solicitouCpf: boolean;
  informouProtocoloEmail: boolean;
  resolveuSolicitacao: boolean;
  validouEmailPorExtenso: boolean;
  semDiminutivos: boolean;
  encerramentoGeap: boolean;
  usoCorretoFerramentas: boolean;
  checklist: ChecklistItem[];
};

export type AvaliacaoCuradorResumoRow = {
  id: string;
  atendimentoId: string;
  avaliacaoIaId: string;
  autorId: string;
  autorNome: string;
  nota: string;
  falhasIdentificadas: string[];
  resumoAtendimento: string | null;
  notaAvaliacaoIa: string;
  comentario: string | null;
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
      c.descricao as descricao,
      ac.estado,
      ac.valor_criterio as valor,
      ac.criterio_critico as critico,
      ac.criterio_ordem as ordem
    from avaliacao_criterios ac
    left join criterios c on c.id = ac.criterio_id
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
          a.nota_qualidade as "notaQualidade",
          a.atendimento_aprovado as "atendimentoAprovado",
          a.falhas_identificadas as "falhasIdentificadas",
          a.resumo_atendimento as "resumoAtendimento",
          p.versao as "promptVersao",
          a.criado_em as "criadoEm",
          a.saudacao_e_intencao as "saudacaoEIntencao",
          a.solicitou_cpf as "solicitouCpf",
          a.informou_protocolo_email as "informouProtocoloEmail",
          a.resolveu_solicitacao as "resolveuSolicitacao",
          a.validou_email_por_extenso as "validouEmailPorExtenso",
          a.sem_diminutivos as "semDiminutivos",
          a.encerramento_geap as "encerramentoGeap",
          a.uso_correto_ferramentas as "usoCorretoFerramentas"
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
          a.avaliacao_ia_id as "avaliacaoIaId",
          a.autor_usuario_id as "autorId",
          a.autor_usuario_nome as "autorNome",
          a.nota,
          a.falhas_identificadas as "falhasIdentificadas",
          a.resumo_atendimento as "resumoAtendimento",
          a.nota_avaliacao_ia as "notaAvaliacaoIa",
          a.comentario,
          a.criado_em as "criadoEm"
        from avaliacoes_curador a
        where a.atendimento_id = $1
        order by a.criado_em desc, a.id desc
        limit 1
      `, [atendimentoId]);
      const row = avaliacao.rows[0];
      if (!row) {
        return null;
      }

      const checklist = await db.query<ChecklistItem>(`
        select
          ac.criterio_chave as chave,
          ac.criterio_nome as nome,
          c.descricao as descricao,
          ac.estado,
          ac.valor_criterio as valor,
          ac.criterio_critico as critico,
          ac.criterio_ordem as ordem
        from avaliacao_curador_criterios ac
        left join criterios c on c.id = ac.criterio_id
        where ac.avaliacao_curador_id = $1
        order by ac.criterio_ordem
      `, [row.id]);

      return {
        ...row,
        falhasIdentificadas: Array.isArray(row.falhasIdentificadas)
          ? row.falhasIdentificadas
          : [],
        checklist: checklist.rows
      };
    }
  };
}
