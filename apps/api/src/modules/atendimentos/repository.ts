import type {
  AtendimentoSummary,
  IngestAtendimento
} from '@hq-geap/contracts/atendimentos';
import type pg from 'pg';

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
  eventTimestamp: string | null;
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
    a.elevenlabs_event_timestamp as "eventTimestamp"
  from atendimentos a
  join agentes_voz av on av.id = a.agente_voz_id
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
          atendimento.event_timestamp
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
                atualizado_em = now()
            where elevenlabs_conversation_id = $2
          `, values);
        } else {
          await client.query(`
            insert into atendimentos (
              agente_voz_id, elevenlabs_conversation_id, status, iniciado_em,
              concluido_em, duracao_segundos, transcricao, audio_url,
              motivo_contato, houve_transferencia, custo,
              elevenlabs_event_timestamp
            ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
          `, values);
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
      limit: number,
      offset: number,
      status?: AtendimentoSummary['status']
    ): Promise<AtendimentoSummaryRow[]> {
      const result = await db.query<AtendimentoSummaryRow>(`
        ${selectAtendimentoSummary}
        where ($3::text is null or a.status = $3)
        order by a.criado_em desc, a.id desc
        limit $1 offset $2
      `, [limit, offset, status ?? null]);
      return result.rows;
    },

    async findById(id: string): Promise<AtendimentoRow | null> {
      const result = await db.query<AtendimentoRow>(
        `${selectAtendimento} where a.id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    }
  };
}
