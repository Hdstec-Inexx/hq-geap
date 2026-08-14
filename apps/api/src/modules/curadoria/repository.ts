import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';
import type pg from 'pg';
import type { AtendimentoRow } from '../atendimentos/repository.js';
import type { AvaliacaoIaRow } from '../avaliacoes/repository.js';
import type { CriterioConferencia } from './service.js';

export type FilaCuradoriaRow = {
  id: string;
  conversationId: string;
  agenteVozNome: string;
  concluidoEm: Date;
  duracaoSegundos: number | null;
  motivoContato: string | null;
  notaIa: string;
};

export type AvaliacaoCuradorRow = {
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
  checklist: CriterioConferencia[];
};

export type CuradoriaAtendimentoRow = AtendimentoRow & {
  avaliacaoIa: AvaliacaoIaRow & { checklist: CriterioConferencia[] };
  historico: AvaliacaoCuradorRow[];
};

export type CreateAvaliacaoCuradorInput = {
  atendimentoId: string;
  avaliacaoIaId: string;
  autorUsuarioId: string;
  nota: number;
  falhasIdentificadas: string[];
  resumoAtendimento: string | null;
  notaAvaliacaoIa: number;
  comentario: string | null;
  checklist: Array<CriterioConferencia & { estado: EstadoCriterio }>;
};

async function findIaChecklists(
  queryable: pg.Pool | pg.PoolClient,
  avaliacaoIds: string[]
): Promise<Map<string, CriterioConferencia[]>> {
  const byId = new Map<string, CriterioConferencia[]>();
  for (const id of avaliacaoIds) {
    byId.set(id, []);
  }
  if (avaliacaoIds.length === 0) {
    return byId;
  }

  const result = await queryable.query<CriterioConferencia & { avaliacaoId: string }>(`
    select
      ac.avaliacao_id as "avaliacaoId",
      ac.criterio_id as "criterioId",
      ac.criterio_chave as chave,
      ac.criterio_nome as nome,
      ac.estado,
      ac.valor_criterio as valor,
      ac.criterio_critico as critico,
      ac.criterio_condicional as condicional,
      ac.criterio_ordem as ordem
    from avaliacao_criterios ac
    where ac.avaliacao_id = any($1::uuid[])
    order by ac.avaliacao_id, ac.criterio_ordem
  `, [avaliacaoIds]);

  for (const row of result.rows) {
    const { avaliacaoId, ...criterio } = row;
    byId.get(avaliacaoId)?.push(criterio);
  }
  return byId;
}

async function findCuradorChecklists(
  queryable: pg.Pool | pg.PoolClient,
  avaliacaoIds: string[]
): Promise<Map<string, CriterioConferencia[]>> {
  const byId = new Map<string, CriterioConferencia[]>();
  for (const id of avaliacaoIds) {
    byId.set(id, []);
  }
  if (avaliacaoIds.length === 0) {
    return byId;
  }

  const result = await queryable.query<CriterioConferencia & { avaliacaoId: string }>(`
    select
      ac.avaliacao_curador_id as "avaliacaoId",
      ac.criterio_id as "criterioId",
      ac.criterio_chave as chave,
      ac.criterio_nome as nome,
      ac.estado,
      ac.valor_criterio as valor,
      ac.criterio_critico as critico,
      ac.criterio_condicional as condicional,
      ac.criterio_ordem as ordem
    from avaliacao_curador_criterios ac
    where ac.avaliacao_curador_id = any($1::uuid[])
    order by ac.avaliacao_curador_id, ac.criterio_ordem
  `, [avaliacaoIds]);

  for (const row of result.rows) {
    const { avaliacaoId, ...criterio } = row;
    byId.get(avaliacaoId)?.push(criterio);
  }
  return byId;
}

export function createCuradoriaRepository(db: pg.Pool) {
  return {
    async listPending(
      limit: number,
      offset: number
    ): Promise<{ items: FilaCuradoriaRow[]; total: number }> {
      const count = await db.query<{ total: string }>(
        'select count(*)::text as total from fila_curadoria'
      );
      const result = await db.query<FilaCuradoriaRow>(`
        select
          a.id,
          a.elevenlabs_conversation_id as "conversationId",
          agente.nome as "agenteVozNome",
          a.concluido_em as "concluidoEm",
          a.duracao_segundos as "duracaoSegundos",
          a.motivo_contato as "motivoContato",
          ia.nota as "notaIa"
        from fila_curadoria a
        join agentes_voz agente on agente.id = a.agente_voz_id
        join avaliacoes ia on ia.atendimento_id = a.id and ia.autor = 'ia'
        order by a.concluido_em, a.id
        limit $1 offset $2
      `, [limit, offset]);
      return {
        items: result.rows,
        total: Number(count.rows[0]?.total ?? 0)
      };
    },

    async findDetail(atendimentoId: string): Promise<CuradoriaAtendimentoRow | null> {
      const atendimento = await db.query<Omit<AtendimentoRow, 'transcricao' | 'audioReference'> & {
        transcricao: unknown;
        audioReference: string | null;
      }>(`
        select
          a.id,
          a.elevenlabs_conversation_id as "conversationId",
          a.agente_voz_id as "agenteVozId",
          agente.nome as "agenteVozNome",
          agente.elevenlabs_agent_id as "agentId",
          a.status,
          a.iniciado_em as "iniciadoEm",
          a.concluido_em as "concluidoEm",
          a.duracao_segundos as "duracaoSegundos",
          a.motivo_contato as "motivoContato",
          a.houve_transferencia as "houveTransferencia",
          a.custo,
          a.elevenlabs_event_timestamp as "eventTimestamp",
          a.transcricao,
          a.audio_url as "audioReference"
        from atendimentos a
        join agentes_voz agente on agente.id = a.agente_voz_id
        where a.id = $1
      `, [atendimentoId]);
      const atendimentoRow = atendimento.rows[0];
      if (!atendimentoRow) return null;

      const iaResult = await db.query<Omit<AvaliacaoIaRow, 'checklist'>>(`
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
      const ia = iaResult.rows[0];
      if (!ia) return null;

      const avaliacoes = await db.query<Omit<AvaliacaoCuradorRow, 'checklist'>>(`
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
      `, [atendimentoId]);

      const iaChecklists = await findIaChecklists(db, [ia.id]);
      const curadorChecklists = await findCuradorChecklists(
        db,
        avaliacoes.rows.map((avaliacao) => avaliacao.id)
      );

      return {
        ...atendimentoRow,
        avaliacaoIa: { ...ia, checklist: iaChecklists.get(ia.id) ?? [] },
        historico: avaliacoes.rows.map((avaliacao) => ({
          ...avaliacao,
          falhasIdentificadas: Array.isArray(avaliacao.falhasIdentificadas)
            ? avaliacao.falhasIdentificadas
            : [],
          checklist: curadorChecklists.get(avaliacao.id) ?? []
        }))
      };
    },

    async createEvaluation(
      input: CreateAvaliacaoCuradorInput
    ): Promise<AvaliacaoCuradorRow> {
      const client = await db.connect();
      try {
        await client.query('begin');
        const result = await client.query<Omit<AvaliacaoCuradorRow, 'checklist'>>(`
          insert into avaliacoes_curador (
            atendimento_id,
            avaliacao_ia_id,
            autor_usuario_id,
            autor_usuario_nome,
            nota,
            falhas_identificadas,
            resumo_atendimento,
            nota_avaliacao_ia,
            comentario
          ) values (
            $1,
            $2,
            $3,
            (select nome from usuarios where id = $3),
            $4,
            $5::jsonb,
            $6,
            $7,
            $8
          )
          returning
            id,
            atendimento_id as "atendimentoId",
            avaliacao_ia_id as "avaliacaoIaId",
            autor_usuario_id as "autorId",
            autor_usuario_nome as "autorNome",
            nota,
            falhas_identificadas as "falhasIdentificadas",
            resumo_atendimento as "resumoAtendimento",
            nota_avaliacao_ia as "notaAvaliacaoIa",
            comentario,
            criado_em as "criadoEm"
        `, [
          input.atendimentoId,
          input.avaliacaoIaId,
          input.autorUsuarioId,
          input.nota,
          JSON.stringify(input.falhasIdentificadas),
          input.resumoAtendimento,
          input.notaAvaliacaoIa,
          input.comentario
        ]);
        const avaliacao = result.rows[0]!;
        if (input.checklist.length > 0) {
          await client.query(`
            insert into avaliacao_curador_criterios (
              avaliacao_curador_id, criterio_id, criterio_chave, criterio_nome,
              criterio_critico, criterio_condicional, criterio_ordem, estado,
              valor_criterio
            )
            select
              $1,
              x.criterio_id,
              x.criterio_chave,
              x.criterio_nome,
              x.criterio_critico,
              x.criterio_condicional,
              x.criterio_ordem,
              x.estado::estado_criterio,
              x.valor_criterio
            from unnest(
              $2::uuid[],
              $3::text[],
              $4::text[],
              $5::boolean[],
              $6::boolean[],
              $7::smallint[],
              $8::text[],
              $9::numeric[]
            ) as x(
              criterio_id, criterio_chave, criterio_nome, criterio_critico,
              criterio_condicional, criterio_ordem, estado, valor_criterio
            )
          `, [
            avaliacao.id,
            input.checklist.map((c) => c.criterioId),
            input.checklist.map((c) => c.chave),
            input.checklist.map((c) => c.nome),
            input.checklist.map((c) => c.critico),
            input.checklist.map((c) => c.condicional),
            input.checklist.map((c) => c.ordem),
            input.checklist.map((c) => c.estado),
            input.checklist.map((c) => c.valor)
          ]);
        }
        await client.query('commit');
        return {
          ...avaliacao,
          falhasIdentificadas: Array.isArray(avaliacao.falhasIdentificadas)
            ? avaliacao.falhasIdentificadas
            : input.falhasIdentificadas,
          checklist: input.checklist
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
