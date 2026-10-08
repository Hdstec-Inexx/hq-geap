import type {
  AtendimentoSummary,
  AtendimentosQuery,
  FavoritosInfo,
  IngestAtendimento
} from '@hq-geap/contracts/atendimentos';
import type { FavoritosQuery } from '@hq-geap/contracts/favoritos';
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
  favoritadoPeloUsuario?: boolean;
  favoritosCount?: number;
  favoritosPerfis?: string[];
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
    (
      select avaliacao_ia.nota
      from avaliacoes avaliacao_ia
      where avaliacao_ia.atendimento_id = a.id
        and avaliacao_ia.autor = 'ia'
    ) as "notaIa",
    a.elevenlabs_event_timestamp as "eventTimestamp",
    cur.autor_usuario_id as "curadorId",
    cur.autor_usuario_nome as "curadorNome",
    cur.nota as "curadoriaNota",
    cur.criado_em as "curadoriaRealizadaEm"
  from atendimentos a
  join agentes_voz av on av.id = a.agente_voz_id
  left join avaliacoes_curador_mais_recentes cur on cur.atendimento_id = a.id
`;

const selectAtendimento = `
  select summary.*, a.transcricao, a.audio_url as "audioReference"
  from (${selectAtendimentoSummary}) summary
  join atendimentos a on a.id = summary.id
`;

const selectAtendimentoSummaryWithFavoritos = (perfilPlaceholder: string) =>
  selectAtendimentoSummary.replace(
    'from atendimentos a',
    `,
    exists (
      select 1 from favoritos f_usuario
      where f_usuario.atendimento_id = a.id
        and f_usuario.perfil_id = ${perfilPlaceholder}
    ) as "favoritadoPeloUsuario",
    (select count(*)::int from favoritos f_count where f_count.atendimento_id = a.id) as "favoritosCount",
    (select coalesce(array_agg(u.nome order by f.favoritado_em asc, u.nome asc), '{}')
     from favoritos f join usuarios u on u.id = f.perfil_id
     where f.atendimento_id = a.id) as "favoritosPerfis"
   from atendimentos a`
  );

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
      query: AtendimentosQuery,
      perfilId: string | null = null
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
          ${selectAtendimentoSummaryWithFavoritos(`$${4 + detalhamento.values.length}`)}
          where ${clauses.join(' and ')}
          order by coalesce(a.concluido_em, a.iniciado_em, a.criado_em) asc, a.id asc
          limit $1 offset $2
        `, [
          query.limit,
          query.offset,
          query.status ?? null,
           ...detalhamento.values,
           perfilId
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

    async findByConversationId(conversationId: string): Promise<AtendimentoRow | null> {
      const result = await db.query<AtendimentoRow>(
        `${selectAtendimento} where a.elevenlabs_conversation_id = $1`,
        [conversationId]
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
    },

    async addFavorito(atendimentoId: string, perfilId: string): Promise<void> {
      await db.query(`
        insert into favoritos (perfil_id, atendimento_id)
        values ($1, $2)
        on conflict (perfil_id, atendimento_id) do nothing
      `, [perfilId, atendimentoId]);
    },

    async removeFavorito(atendimentoId: string, perfilId: string): Promise<void> {
      await db.query(`
        delete from favoritos
        where atendimento_id = $1 and perfil_id = $2
      `, [atendimentoId, perfilId]);
    },

    async isFavoritadoByPerfil(atendimentoId: string, perfilId: string): Promise<boolean> {
      const result = await db.query<{ exists: boolean }>(`
        select exists(
          select 1 from favoritos
          where atendimento_id = $1 and perfil_id = $2
        ) as exists
      `, [atendimentoId, perfilId]);
      return Boolean(result.rows[0]?.exists);
    },

    async findFavoritos(atendimentoId: string): Promise<FavoritosInfo> {
      const result = await db.query<{ id: string; nome: string }>(`
        select u.id, u.nome
        from favoritos f
        join usuarios u on u.id = f.perfil_id
        where f.atendimento_id = $1
        order by f.favoritado_em asc, u.nome asc
      `, [atendimentoId]);
      return {
        count: result.rows.length,
        perfis: result.rows
      };
    },

    async listFavoritos(query: FavoritosQuery, perfilId: string | null) {
      const values: unknown[] = [query.limit, query.offset];
      const clauses = ['1 = 1'];
      const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
      if (query.agenteVozId) clauses.push(`a.agente_voz_id = ${add(query.agenteVozId)}`);
      if (query.conversationId) clauses.push(`a.elevenlabs_conversation_id ilike '%' || ${add(query.conversationId)} || '%'`);
      if (perfilId) clauses.push(`f.perfil_id = ${add(perfilId)}`);
      if (query.perfilId) {
        clauses.push(`exists (select 1 from favoritos filtro where filtro.atendimento_id = a.id and filtro.perfil_id = ${add(query.perfilId)})`);
      }
      const countClauses = clauses.map((clause) =>
        clause.replace(/\$(\d+)/g, (_match, value: string) => `$${Number(value) - 2}`)
      );

      if (perfilId) {
        const [count, result] = await Promise.all([
          db.query<{ total: string }>(`select count(*)::text as total from favoritos f join atendimentos a on a.id = f.atendimento_id where ${countClauses.join(' and ')}`, values.slice(2)),
          db.query(`select summary.*, f.favoritado_em as "favoritadoEm" from favoritos f join (${selectAtendimentoSummary}) summary on summary.id = f.atendimento_id join atendimentos a on a.id = summary.id where ${clauses.join(' and ')} order by f.favoritado_em desc, f.atendimento_id desc limit $1 offset $2`, values)
        ]);
        return { items: result.rows, total: Number(count.rows[0]?.total ?? 0) };
      }

      const groupClauses = clauses;
      const countValues = values.slice(2);
      const [count, result] = await Promise.all([
        db.query<{ total: string }>(`select count(*)::text as total from (select a.id from favoritos f join atendimentos a on a.id = f.atendimento_id where ${countClauses.join(' and ')} group by a.id) grouped`, countValues),
        db.query(`select summary.*, max(f.favoritado_em) as "ultimoFavoritadoEm", jsonb_build_object('count', count(f.id), 'perfis', jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome) order by f.favoritado_em asc, u.nome asc)) as favoritos from favoritos f join (${selectAtendimentoSummary}) summary on summary.id = f.atendimento_id join atendimentos a on a.id = summary.id join usuarios u on u.id = f.perfil_id where ${groupClauses.join(' and ')} group by summary.id, summary."conversationId", summary."agenteVozId", summary."agenteVozNome", summary."agentId", summary.status, summary."iniciadoEm", summary."concluidoEm", summary."duracaoSegundos", summary."motivoContato", summary."houveTransferencia", summary.custo, summary."notaIa", summary."eventTimestamp", summary."curadorId", summary."curadorNome", summary."curadoriaNota", summary."curadoriaRealizadaEm" order by max(f.favoritado_em) desc, summary.id desc limit $1 offset $2`, values)
      ]);
      return { items: result.rows, total: Number(count.rows[0]?.total ?? 0) };
    }
  };
}
