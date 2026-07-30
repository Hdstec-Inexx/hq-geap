import type { StatusComentario } from '@hq-geap/contracts/comentarios';
import type pg from 'pg';

export type ComentarioRow = {
  id: string;
  atendimentoId: string;
  texto: string;
  status: StatusComentario;
  autorId: string;
  autorNome: string;
  resolvidoPorId: string | null;
  resolvidoPorNome: string | null;
  resolvidoEm: Date | null;
  criadoEm: Date;
};

export type ComentarioFilaRow = ComentarioRow & {
  conversationId: string;
  agenteVozNome: string;
};

const comentarioColumns = `
  c.id,
  c.atendimento_id as "atendimentoId",
  c.texto,
  c.status,
  autor.id as "autorId",
  autor.nome as "autorNome",
  responsavel.id as "resolvidoPorId",
  responsavel.nome as "resolvidoPorNome",
  c.resolvido_em as "resolvidoEm",
  c.criado_em as "criadoEm"
`;

const comentarioFrom = `
  from comentarios c
  join usuarios autor on autor.id = c.autor_usuario_id
  left join usuarios responsavel on responsavel.id = c.resolvido_por
`;

export function createComentariosRepository(db: pg.Pool) {
  return {
    async atendimentoExists(atendimentoId: string) {
      const result = await db.query(
        'select 1 from atendimentos where id = $1',
        [atendimentoId]
      );
      return result.rowCount === 1;
    },

    async listByAtendimento(atendimentoId: string): Promise<ComentarioRow[]> {
      const result = await db.query<ComentarioRow>(`
        select ${comentarioColumns}
        ${comentarioFrom}
        where c.atendimento_id = $1
        order by c.criado_em desc, c.id desc
      `, [atendimentoId]);
      return result.rows;
    },

    async create(
      atendimentoId: string,
      autorUsuarioId: string,
      texto: string
    ): Promise<ComentarioRow> {
      const inserted = await db.query<{ id: string }>(`
        insert into comentarios (atendimento_id, autor_usuario_id, texto)
        values ($1, $2, $3)
        returning id
      `, [atendimentoId, autorUsuarioId, texto]);
      return (await this.findById(inserted.rows[0]!.id))!;
    },

    async findById(id: string): Promise<ComentarioRow | null> {
      const result = await db.query<ComentarioRow>(`
        select ${comentarioColumns}
        ${comentarioFrom}
        where c.id = $1
      `, [id]);
      return result.rows[0] ?? null;
    },

    async listByStatus(status: StatusComentario): Promise<ComentarioFilaRow[]> {
      const result = await db.query<ComentarioFilaRow>(`
        select ${comentarioColumns},
        a.elevenlabs_conversation_id as "conversationId",
        agente.nome as "agenteVozNome"
        ${comentarioFrom}
        join atendimentos a on a.id = c.atendimento_id
        join agentes_voz agente on agente.id = a.agente_voz_id
        where c.status = $1
        order by c.criado_em, c.id
      `, [status]);
      return result.rows;
    },

    async resolve(id: string, responsavelId: string): Promise<ComentarioRow | null> {
      const updated = await db.query<{ id: string }>(`
        update comentarios
        set status = 'resolvido', resolvido_por = $2, resolvido_em = now()
        where id = $1 and status = 'pendente'
        returning id
      `, [id, responsavelId]);
      if (!updated.rows[0]) return null;
      return this.findById(updated.rows[0].id);
    }
  };
}
