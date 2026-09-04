import type {
  AtendimentoSummary,
  AtendimentosQuery,
  IngestAtendimento
} from '@hq-geap/contracts/atendimentos';
import type pg from 'pg';
import { buildDetalhamentoFilters, canonicalMotivoSql } from './detalhamentoFilters.js';

export type AtendimentoSummaryRow = {
  id: string;
  conversationId: string;
  agenteVozId: string;
  agenteVozNome: string;
  agentId: string;
  status: AtendimentoSummary['status'];
  iniciadoEm: Date | null;
  concluidoEm: Date | null;
  duracaoSegundos: number | null;
  motivoContato: string | null;
  houveTransferencia: boolean;
  custo: string | null;
  notaIa: string | null;
  eventTimestamp: string | null;
  curadorId: string | null;
  curadorNome: string | null;
  curadoriaNota: string | null;
  curadoriaRealizadaEm: Date | null;
};

export type AtendimentoRow = AtendimentoSummaryRow & {
  transcricao: unknown;
  audioReference: string | null;
};

export class UnknownVoiceAgentError extends Error {}
export class InvalidAtendimentoTransitionError extends Error {}
export class AtendimentoAgentMismatchError extends Error {}

const selectAtendimentoSummary = `
  select
    a.id,
    a.elevenlabs_conversation_id as "conversationId",
    a.agente_voz_id as "agenteVozId",
    av.nome as "agenteVozNome",
    av.elevenlabs_agent_id as "agentId",
    a.status,
    a.iniciado_em as "iniciadoEm",
    a.concluido_em as "concluidoEm",
    a.duracao_segundos as "duracaoSegundos",
    a.motivo_contato as "motivoContato",
    a.houve_transferencia as "houveTransferencia",
    a.custo,
    avaliacao_ia.nota as "notaIa",
    a.elevenlabs_event_timestamp as "eventTimestamp",
    cur.autor_usuario_id as "curadorId",
    cur.autor_usuario_nome as "curadorNome",
    cur.nota as "curadoriaNota",
    cur.criado_em as "curadoriaRealizadaEm"
  from atendimentos a
  join agentes_voz av on av.id = a.agente_voz_id
  left join avaliacoes_curador_mais_recentes cur on cur.atendimento_id = a.id
  left join avaliacoes avaliacao_ia
    on avaliacao_ia.atendimento_id = a.id and avaliacao_ia.autor = 'ia'
`;

const selectAtendimento = `
  select summary.*, a.transcricao, a.audio_url as "audioReference"
  from (${selectAtendimentoSummary}) summary
  join atendimentos a on a.id = summary.id
`;

export function createAtendimentosRepository(db: pg.Pool) {
  return {
    async ingest(
      atendimento: IngestAtendimento
    ): Promise<{ created: boolean; row: AtendimentoRow }> {
      const client = await db.connect();
      try {
        await client.query('begin');
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [atendimento.conversation_id]
        );

        const agent = await client.query<{ id: string }>(
          'select id from agentes_voz where elevenlabs_agent_id = $1',
          [atendimento.agent_id]
        );
        const agentId = agent.rows[0]?.id;
        if (!agentId) {
          throw new UnknownVoiceAgentError(atendimento.agent_id);
        }

        const existing = await client.query<{
          agenteVozId: string;
          eventTimestamp: string | null;
          status: 'em_andamento' | 'concluido';
        }>(`
          select agente_voz_id as "agenteVozId",
                 elevenlabs_event_timestamp as "eventTimestamp",
                 status
          from atendimentos
          where elevenlabs_conversation_id = $1
          for update
        `, [atendimento.conversation_id]);
        const current = existing.rows[0];
        if (current && current.agenteVozId !== agentId) {
          throw new AtendimentoAgentMismatchError(atendimento.conversation_id);
        }
        if (current?.status === 'concluido' && atendimento.status === 'em_andamento') {
          throw new InvalidAtendimentoTransitionError(atendimento.conversation_id);
        }
        if (
          current?.eventTimestamp !== null &&
          current?.eventTimestamp !== undefined &&
          Number(current.eventTimestamp) > atendimento.event_timestamp
        ) {
          const result = await client.query<AtendimentoRow>(
            `${selectAtendimento} where a.elevenlabs_conversation_id = $1`,
            [atendimento.conversation_id]
          );
          await client.query('commit');
          return { created: false, row: result.rows[0]! };
        }
        const toolExecutions = atendimento.tool_executions;
        const hasToolExecutions = toolExecutions !== undefined;
        const values = [
          agentId,
          atendimento.conversation_id,
          atendimento.status,
          atendimento.started_at ?? null,
          atendimento.completed_at ?? null,
          atendimento.duration_seconds ?? null,
          JSON.stringify(atendimento.transcript),
          atendimento.audio_reference ?? null,
          atendimento.contact_reason ?? null,
          atendimento.transferred,
          atendimento.cost ?? null,
          atendimento.event_timestamp,
          atendimento.tme_seconds ?? null,
          toolExecutions?.total ?? 0,
          toolExecutions?.successful ?? 0,
          hasToolExecutions
        ];

        if (current) {
          await client.query(`
            update atendimentos
            set status = $3,
                iniciado_em = coalesce($4, iniciado_em),
                concluido_em = coalesce($5, concluido_em),
                duracao_segundos = coalesce($6, duracao_segundos),
                transcricao = $7::jsonb,
                audio_url = coalesce($8, audio_url),
                motivo_contato = coalesce($9, motivo_contato),
                houve_transferencia = houve_transferencia or $10,
                custo = coalesce($11, custo),
                elevenlabs_event_timestamp = $12,
                tme_segundos = coalesce($13, tme_segundos),
                tools_executados = case when $16 then $14 else tools_executados end,
                tools_sucesso = case when $16 then $15 else tools_sucesso end,
                atualizado_em = now()
            where elevenlabs_conversation_id = $2
              and agente_voz_id = $1
          `, values);
        } else {
          await client.query(`
            insert into atendimentos (
              agente_voz_id, elevenlabs_conversation_id, status, iniciado_em,
              concluido_em, duracao_segundos, transcricao, audio_url,
              motivo_contato, houve_transferencia, custo,
              elevenlabs_event_timestamp, tme_segundos,
              tools_executados, tools_sucesso
            ) values (
              $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15
            )
          `, values.slice(0, 15));
        }

        const result = await client.query<AtendimentoRow>(
          `${selectAtendimento} where a.elevenlabs_conversation_id = $1`,
          [atendimento.conversation_id]
        );
        await client.query('commit');
        return { created: !current, row: result.rows[0]! };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async list(
      query: AtendimentosQuery
    ): Promise<{ items: AtendimentoSummaryRow[]; total: number }> {
      const detalhamento = buildDetalhamentoFilters(query, 4);
      const clauses = [
        '($3::status_atendimento is null or a.status = $3::status_atendimento)',
        ...detalhamento.clauses
      ];
      const countDetalhamento = buildDetalhamentoFilters(query, 2);
      const countClauses = [
        '($1::status_atendimento is null or a.status = $1::status_atendimento)',
        ...countDetalhamento.clauses
      ];
      const [count, result] = await Promise.all([
        db.query<{ total: string }>(`
          select count(*)::text as total
          from atendimentos a
          join agentes_voz av on av.id = a.agente_voz_id
          left join avaliacoes_curador_mais_recentes cur on cur.atendimento_id = a.id
          where ${countClauses.join(' and ')}
        `, [query.status ?? null, ...countDetalhamento.values]),
        db.query<AtendimentoSummaryRow>(`
          ${selectAtendimentoSummary}
          where ${clauses.join(' and ')}
          order by a.criado_em desc, a.id desc
          limit $1 offset $2
        `, [
          query.limit,
          query.offset,
          query.status ?? null,
          ...detalhamento.values
        ])
      ]);
      return {
        items: result.rows,
        total: Number(count.rows[0]?.total ?? 0)
      };
    },

    async findById(id: string): Promise<AtendimentoRow | null> {
      const result = await db.query<AtendimentoRow>(
        `${selectAtendimento} where a.id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    },

    async listDistinctMotivos(): Promise<string[]> {
      const result = await db.query<{ motivo: string }>(`
        select distinct ${canonicalMotivoSql('motivo_contato')} as motivo
        from atendimentos
        order by motivo
      `);
      return result.rows.map((row) => row.motivo);
    }
  };
}
