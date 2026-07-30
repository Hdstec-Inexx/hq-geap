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
  autorId: string;
  autorNome: string;
  nota: string;
  criadoEm: Date;
  checklist: CriterioConferencia[];
};

export type CuradoriaAtendimentoRow = AtendimentoRow & {
  avaliacaoIa: AvaliacaoIaRow & { checklist: CriterioConferencia[] };
  historico: AvaliacaoCuradorRow[];
};

async function findChecklist(
  queryable: pg.Pool | pg.PoolClient,
  avaliacaoId: string
): Promise<CriterioConferencia[]> {
  const result = await queryable.query<CriterioConferencia>(`
    select
      ac.criterio_id as "criterioId",
      ac.criterio_chave as chave,
      ac.criterio_nome as nome,
      ac.estado,
      ac.valor_criterio as valor,
      ac.criterio_critico as critico,
      ac.criterio_condicional as condicional,
      ac.criterio_ordem as ordem
    from avaliacao_criterios ac
    where ac.avaliacao_id = $1
    order by ac.criterio_ordem
  `, [avaliacaoId]);
  return result.rows;
}

export function createCuradoriaRepository(db: pg.Pool) {
  return {
    async listPending(): Promise<FilaCuradoriaRow[]> {
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
      `);
      return result.rows;
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
          a.falhas_identificadas as "falhasIdentificadas",
          a.resumo_atendimento as "resumoAtendimento",
          p.versao as "promptVersao",
          a.criado_em as "criadoEm"
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
          a.autor_usuario_id as "autorId",
          a.autor_usuario_nome as "autorNome",
          a.nota,
          a.criado_em as "criadoEm"
        from avaliacoes a
        where a.atendimento_id = $1 and a.autor = 'curador'
        order by a.criado_em desc, a.id desc
      `, [atendimentoId]);
      const historico = await Promise.all(
        avaliacoes.rows.map(async (avaliacao) => ({
          ...avaliacao,
          checklist: await findChecklist(db, avaliacao.id)
        }))
      );

      return {
        ...atendimentoRow,
        avaliacaoIa: { ...ia, checklist: await findChecklist(db, ia.id) },
        historico
      };
    },

    async createEvaluation(
      atendimentoId: string,
      autorUsuarioId: string,
      nota: number,
      checklist: Array<CriterioConferencia & { estado: EstadoCriterio }>
    ): Promise<AvaliacaoCuradorRow> {
      const client = await db.connect();
      try {
        await client.query('begin');
        const result = await client.query<Omit<AvaliacaoCuradorRow, 'checklist'>>(`
          insert into avaliacoes (
            atendimento_id, autor, autor_usuario_id, autor_usuario_nome, nota
          ) values (
            $1, 'curador', $2, (select nome from usuarios where id = $2), $3
          )
          returning
            id,
            atendimento_id as "atendimentoId",
            autor_usuario_id as "autorId",
            autor_usuario_nome as "autorNome",
            nota,
            criado_em as "criadoEm"
        `, [atendimentoId, autorUsuarioId, nota]);
        const avaliacao = result.rows[0]!;
        for (const criterio of checklist) {
          await client.query(`
            insert into avaliacao_criterios (
              avaliacao_id, criterio_id, criterio_chave, criterio_nome,
              criterio_critico, criterio_condicional, criterio_ordem, estado,
              valor_criterio
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            avaliacao.id,
            criterio.criterioId,
            criterio.chave,
            criterio.nome,
            criterio.critico,
            criterio.condicional,
            criterio.ordem,
            criterio.estado,
            criterio.valor
          ]);
        }
        await client.query('commit');
        return { ...avaliacao, checklist };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
