import {
  SLA_TME_LIMITE_SEGUNDOS,
  type DashboardPeriod
} from '@hq-geap/contracts/dashboards';
import type pg from 'pg';
import { canonicalMotivoSql } from '../atendimentos/detalhamentoFilters.js';

export type DashboardKpisRow = {
  volume: string;
  tmaSegundos: string | null;
  resolvidas: string;
  dentroSla: string;
  notaMediaIa: string | null;
  notaMediaCurador: string | null;
  avaliadosIa: string;
  avaliadosCurador: string;
  toolsTotal: string;
  toolsSuccessful: string;
  tempoMedioAteResolucao: string | null;
};

export type MotivoContatoRow = {
  motivo: string;
  total: string;
};

export type CriterioRow = {
  criterioId: string;
  chave: string;
  nome: string;
  atendidos: string;
  avaliados: string;
};

export type CriterioNaoConformidadeRow = {
  criterioId: string;
  chave: string;
  nome: string;
  total: string;
};

export type ConcordanciaRow = {
  notasConcordantes: string;
  totalNotas: string;
  criteriosConcordantes: string;
  totalCriterios: string;
};

export type ConcordanciaCriterioRow = {
  criterioId: string;
  chave: string;
  nome: string;
  concordantes: string;
  total: string;
};

export type PiorAtendimentoRow = {
  id: string;
  conversationId: string;
  concluidoEm: Date;
  motivoContato: string | null;
  notaIa: string;
  notaCurador: string | null;
};

const periodFilter = `
  a.status = 'concluido'
  and a.concluido_em >= $1::date
  and a.concluido_em < $2::date + interval '1 day'
`;

export function createDashboardRepository(db: pg.Pool) {
  return {
    async getKpis(periodo: DashboardPeriod): Promise<DashboardKpisRow> {
      const result = await db.query<DashboardKpisRow>(`
        select
          count(*) as volume,
          avg(a.duracao_segundos) as "tmaSegundos",
          count(*) filter (where not a.houve_transferencia) as resolvidas,
          count(*) filter (
            where a.tme_segundos is not null
              and a.tme_segundos <= $3
          ) as "dentroSla",
          avg(ia.nota) as "notaMediaIa",
          avg(curador.nota) as "notaMediaCurador",
          count(ia.id) as "avaliadosIa",
          count(curador.id) as "avaliadosCurador",
          coalesce(sum(a.tools_executados), 0) as "toolsTotal",
          coalesce(sum(a.tools_sucesso), 0) as "toolsSuccessful",
          avg(a.duracao_segundos) filter (
            where not a.houve_transferencia
          ) as "tempoMedioAteResolucao"
        from atendimentos a
        left join avaliacoes ia
          on ia.atendimento_id = a.id and ia.autor = 'ia'
        left join lateral (
          select avaliacao.id, avaliacao.nota
          from avaliacoes_curador avaliacao
          where avaliacao.atendimento_id = a.id
          order by avaliacao.criado_em desc, avaliacao.id desc
          limit 1
        ) curador on true
        where ${periodFilter}
      `, [periodo.inicio, periodo.fim, SLA_TME_LIMITE_SEGUNDOS]);
      return result.rows[0]!;
    },

    async listMotivos(periodo: DashboardPeriod): Promise<MotivoContatoRow[]> {
      const result = await db.query<MotivoContatoRow>(`
        select ${canonicalMotivoSql('a.motivo_contato')} as motivo, count(*) as total
        from atendimentos a
        where ${periodFilter}
        group by ${canonicalMotivoSql('a.motivo_contato')}
        order by total desc, motivo asc
      `, [periodo.inicio, periodo.fim]);
      return result.rows;
    },

    async listCriterios(periodo: DashboardPeriod): Promise<CriterioRow[]> {
      const result = await db.query<CriterioRow>(`
        select
          ac.criterio_id as "criterioId",
          ac.criterio_chave as chave,
          ac.criterio_nome as nome,
          count(*) filter (where ac.estado = 'atendido') as atendidos,
          count(*) filter (where ac.estado <> 'nao_se_aplica') as avaliados
        from atendimentos a
        join avaliacoes ia
          on ia.atendimento_id = a.id and ia.autor = 'ia'
        join avaliacao_criterios ac on ac.avaliacao_id = ia.id
        where ${periodFilter}
        group by ac.criterio_id, ac.criterio_chave, ac.criterio_nome, ac.criterio_ordem
        order by ac.criterio_ordem, ac.criterio_nome
      `, [periodo.inicio, periodo.fim]);
      return result.rows;
    },

    async listCriteriosNaoConformidade(
      periodo: DashboardPeriod
    ): Promise<CriterioNaoConformidadeRow[]> {
      const result = await db.query<CriterioNaoConformidadeRow>(`
        select
          ac.criterio_id as "criterioId",
          ac.criterio_chave as chave,
          ac.criterio_nome as nome,
          count(*) as total
        from atendimentos a
        join avaliacoes ia
          on ia.atendimento_id = a.id and ia.autor = 'ia'
        join avaliacao_criterios ac on ac.avaliacao_id = ia.id
        where ${periodFilter}
          and ac.estado = 'nao_atendido'
        group by ac.criterio_id, ac.criterio_chave, ac.criterio_nome, ac.criterio_ordem
        order by total desc, ac.criterio_ordem asc, ac.criterio_nome asc
      `, [periodo.inicio, periodo.fim]);
      return result.rows;
    },

    async getConcordancia(periodo: DashboardPeriod): Promise<ConcordanciaRow> {
      const result = await db.query<ConcordanciaRow>(`
        with pares as (
          select ia.id as ia_id, curador.id as curador_id, ia.nota as nota_ia,
            curador.nota as nota_curador
          from atendimentos a
          join avaliacoes ia
            on ia.atendimento_id = a.id and ia.autor = 'ia'
          join lateral (
            select avaliacao.id, avaliacao.nota
            from avaliacoes_curador avaliacao
            where avaliacao.atendimento_id = a.id
            order by avaliacao.criado_em desc, avaliacao.id desc
            limit 1
          ) curador on true
          where ${periodFilter}
        ),
        notas as (
          select
            count(*) filter (where nota_ia = nota_curador) as concordantes,
            count(*) as total
          from pares
        ),
        checks as (
          select
            count(*) filter (where ia_check.estado = curador_check.estado) as concordantes,
            count(*) as total
          from pares
          join avaliacao_criterios ia_check on ia_check.avaliacao_id = pares.ia_id
          join avaliacao_curador_criterios curador_check
            on curador_check.avaliacao_curador_id = pares.curador_id
            and curador_check.criterio_id = ia_check.criterio_id
        )
        select
          notas.concordantes as "notasConcordantes",
          notas.total as "totalNotas",
          checks.concordantes as "criteriosConcordantes",
          checks.total as "totalCriterios"
        from notas cross join checks
      `, [periodo.inicio, periodo.fim]);
      return result.rows[0]!;
    },

    async listConcordanciaPorCriterio(
      periodo: DashboardPeriod
    ): Promise<ConcordanciaCriterioRow[]> {
      const result = await db.query<ConcordanciaCriterioRow>(`
        select
          ia_check.criterio_id as "criterioId",
          ia_check.criterio_chave as chave,
          ia_check.criterio_nome as nome,
          count(*) filter (where ia_check.estado = curador_check.estado) as concordantes,
          count(*) as total
        from atendimentos a
        join avaliacoes ia
          on ia.atendimento_id = a.id and ia.autor = 'ia'
        join lateral (
          select avaliacao.id
          from avaliacoes_curador avaliacao
          where avaliacao.atendimento_id = a.id
          order by avaliacao.criado_em desc, avaliacao.id desc
          limit 1
        ) curador on true
        join avaliacao_criterios ia_check on ia_check.avaliacao_id = ia.id
        join avaliacao_curador_criterios curador_check
          on curador_check.avaliacao_curador_id = curador.id
          and curador_check.criterio_id = ia_check.criterio_id
        where ${periodFilter}
        group by
          ia_check.criterio_id, ia_check.criterio_chave,
          ia_check.criterio_nome, ia_check.criterio_ordem
        order by ia_check.criterio_ordem, ia_check.criterio_nome
      `, [periodo.inicio, periodo.fim]);
      return result.rows;
    },

    async listPiores(periodo: DashboardPeriod): Promise<PiorAtendimentoRow[]> {
      const result = await db.query<PiorAtendimentoRow>(`
        select
          a.id,
          a.elevenlabs_conversation_id as "conversationId",
          a.concluido_em as "concluidoEm",
          a.motivo_contato as "motivoContato",
          ia.nota as "notaIa",
          curador.nota as "notaCurador"
        from atendimentos a
        join avaliacoes ia
          on ia.atendimento_id = a.id and ia.autor = 'ia'
        left join lateral (
          select avaliacao.nota
          from avaliacoes_curador avaliacao
          where avaliacao.atendimento_id = a.id
          order by avaliacao.criado_em desc, avaliacao.id desc
          limit 1
        ) curador on true
        where ${periodFilter}
        order by ia.nota, a.concluido_em desc, a.id
        limit 10
      `, [periodo.inicio, periodo.fim]);
      return result.rows;
    }
  };
}

export type DashboardRepository = ReturnType<typeof createDashboardRepository>;
