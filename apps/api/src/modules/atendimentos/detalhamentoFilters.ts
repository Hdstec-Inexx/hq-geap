import {
  MOTIVO_NAO_INFORMADO,
  normalizeMotivo,
  type AtendimentosQuery
} from '@hq-geap/contracts/atendimentos';
import { SLA_TME_LIMITE_SEGUNDOS } from '@hq-geap/contracts/dashboards';

export type DetalhamentoSql = {
  clauses: string[];
  values: unknown[];
};

export function canonicalMotivoSql(column = 'a.motivo_contato'): string {
  return `coalesce(nullif(nullif(trim(${column}), ''), 'Nao informado'), '${MOTIVO_NAO_INFORMADO}')`;
}

/**
 * Constrói cláusulas SQL parametrizadas para o Detalhamento do Indicador.
 * Espelha as populações do Dashboard (lado positivo nas taxas).
 */
function buildIaCriterioClause(criterioPlaceholder: string, estado: 'atendido' | 'nao_atendido'): string {
  return `exists (
    select 1
    from avaliacoes ia
    join avaliacao_criterios ac on ac.avaliacao_id = ia.id
    where ia.atendimento_id = a.id
      and ia.autor = 'ia'
      and ac.criterio_id = ${criterioPlaceholder}::uuid
      and ac.estado = '${estado}'
  )`;
}

export function buildDetalhamentoFilters(
  query: AtendimentosQuery,
  startIndex = 1
): DetalhamentoSql {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let next = startIndex;

  const param = (value: unknown) => {
    values.push(value);
    const placeholder = `$${next}`;
    next += 1;
    return placeholder;
  };

  if (query.inicio && query.fim) {
    const inicio = param(query.inicio);
    const fim = param(query.fim);
    clauses.push(
      `a.status = 'concluido' and a.concluido_em at time zone 'America/Sao_Paulo' >= ${inicio}::date and a.concluido_em at time zone 'America/Sao_Paulo' < ${fim}::date + interval '1 day'`
    );
  }

  if (query.conversationId) {
    const conversationId = param(query.conversationId);
    clauses.push(`a.elevenlabs_conversation_id ilike '%' || ${conversationId} || '%'`);
  }

  if (query.motivo && query.indicador !== 'motivo') {
    const motivo = param(normalizeMotivo(query.motivo));
    clauses.push(`${canonicalMotivoSql('a.motivo_contato')} = ${motivo}`);
  }

  if (query.curadoriaStatus === 'realizada') {
    clauses.push('cur.id is not null');
  } else if (query.curadoriaStatus === 'pendente') {
    clauses.push("a.status = 'concluido' and cur.id is null");
  }

  if (query.curadorId) {
    const curadorId = param(query.curadorId);
    clauses.push(`cur.autor_usuario_id = ${curadorId}::uuid`);
  }

  if (query.criteriosAtendidos && query.criteriosAtendidos.length > 0) {
    for (const criterioId of query.criteriosAtendidos) {
      clauses.push(buildIaCriterioClause(param(criterioId), 'atendido'));
    }
  }

  if (query.criteriosNaoAtendidos && query.criteriosNaoAtendidos.length > 0) {
    for (const criterioId of query.criteriosNaoAtendidos) {
      clauses.push(buildIaCriterioClause(param(criterioId), 'nao_atendido'));
    }
  }

  switch (query.indicador) {
    case undefined:
      break;
    case 'volume':
      break;
    case 'tma':
      clauses.push('a.duracao_segundos is not null');
      break;
    case 'resolvidas':
    case 'tempo_resolucao':
      clauses.push('not a.houve_transferencia');
      break;
    case 'sla': {
      const limite = param(SLA_TME_LIMITE_SEGUNDOS);
      clauses.push(
        `a.tme_segundos is not null and a.tme_segundos <= ${limite}`
      );
      break;
    }
    case 'nota_media_ia':
    case 'avaliados_ia':
      clauses.push(`exists (
        select 1 from avaliacoes ia
        where ia.atendimento_id = a.id and ia.autor = 'ia'
      )`);
      break;
    case 'nota_media_curador':
    case 'avaliados_curador':
      clauses.push(`exists (
        select 1 from avaliacoes_curador curador
        where curador.atendimento_id = a.id
      )`);
      break;
    case 'promessas':
      // Lado positivo da Taxa (execuções com sucesso) na lista de Atendimentos:
      // Atendimentos que contribuíram com ao menos um sucesso no período.
      clauses.push('a.tools_sucesso > 0');
      break;
    case 'motivo': {
      const motivo = param(normalizeMotivo(query.motivo!));
      clauses.push(`${canonicalMotivoSql('a.motivo_contato')} = ${motivo}`);
      break;
    }
    case 'criterio': {
      const criterioId = param(query.criterioId!);
      clauses.push(`exists (
          select 1
          from avaliacoes ia
          join avaliacao_criterios ac on ac.avaliacao_id = ia.id
          where ia.atendimento_id = a.id
            and ia.autor = 'ia'
            and ac.criterio_id = ${criterioId}::uuid
            and ac.estado = 'atendido'
        )`);
      break;
    }
    case 'criterio_nao_atendido': {
      const criterioId = param(query.criterioId!);
      clauses.push(`exists (
          select 1
          from avaliacoes ia
          join avaliacao_criterios ac on ac.avaliacao_id = ia.id
          where ia.atendimento_id = a.id
            and ia.autor = 'ia'
            and ac.criterio_id = ${criterioId}::uuid
            and ac.estado = 'nao_atendido'
        )`);
      break;
    }
    case 'concordancia_nota':
      clauses.push(`exists (
        select 1
        from avaliacoes ia
        join lateral (
          select avaliacao.nota
          from avaliacoes_curador avaliacao
          where avaliacao.atendimento_id = a.id
          order by avaliacao.criado_em desc, avaliacao.id desc
          limit 1
        ) curador on true
        where ia.atendimento_id = a.id
          and ia.autor = 'ia'
          and ia.nota = curador.nota
      )`);
      break;
    case 'concordancia_criterio': {
      const criterioId = param(query.criterioId!);
      clauses.push(`exists (
          select 1
          from avaliacoes ia
          join lateral (
            select avaliacao.id
            from avaliacoes_curador avaliacao
            where avaliacao.atendimento_id = a.id
            order by avaliacao.criado_em desc, avaliacao.id desc
            limit 1
          ) curador on true
          join avaliacao_criterios ia_check
            on ia_check.avaliacao_id = ia.id
          join avaliacao_curador_criterios curador_check
            on curador_check.avaliacao_curador_id = curador.id
            and curador_check.criterio_id = ia_check.criterio_id
          where ia.atendimento_id = a.id
            and ia.autor = 'ia'
            and ia_check.criterio_id = ${criterioId}::uuid
            and ia_check.estado = curador_check.estado
        )`);
      break;
    }
    default: {
      const _exhaustive: never = query.indicador;
      void _exhaustive;
      break;
    }
  }

  return { clauses, values };
}

export function isDetalhamentoQuery(query: AtendimentosQuery): boolean {
  return query.indicador !== undefined;
}
