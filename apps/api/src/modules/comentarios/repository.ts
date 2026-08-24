import type {
  FiltroStatusComentario,
  StatusComentario
} from '@hq-geap/contracts/comentarios';
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
  iniciadoEm: Date | null;
  concluidoEm: Date | null;
};

export type ComentariosFilaFilters = Pick<
  FiltroStatusComentario,
  'status' | 'cursor' | 'inicio' | 'fim' | 'conversationId'
>;

export function buildComentariosFilaFilters(
  filters: ComentariosFilaFilters,
  startIndex = 1
) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let next = startIndex;

  const param = (value: unknown) => {
    values.push(value);
    const placeholder = `$${next}`;
    next += 1;
    return placeholder;
  };

  const statusPlaceholder = param(filters.status);
  clauses.push(`c.status = ${statusPlaceholder}`);

  if (filters.cursor) {
    const cursorPlaceholder = param(filters.cursor);
    clauses.push(`(c.criado_em, c.id) > (
      select cursor.criado_em, cursor.id
      from comentarios cursor
      where cursor.id = ${cursorPlaceholder}::uuid
    )`);
  }

  const inicio = filters.inicio;
  const fim = filters.fim ?? filters.inicio;
  if (inicio && fim) {
    const inicioPlaceholder = param(inicio);
    const fimPlaceholder = param(fim);
    clauses.push(
      `c.criado_em at time zone 'America/Sao_Paulo' >= ${inicioPlaceholder}::date and c.criado_em at time zone 'America/Sao_Paulo' < ${fimPlaceholder}::date + interval '1 day'`
    );
  }

  if (filters.conversationId && filters.conversationId.trim()) {
    const convPlaceholder = param(filters.conversationId.trim());
    clauses.push(
      `a.elevenlabs_conversation_id ilike '%' || ${convPlaceholder} || '%'`
    );
  }

  return { clauses, values };
}

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

    async listByStatus(
      params: FiltroStatusComentario
    ): Promise<ComentarioFilaRow[]> {
      const { clauses, values } = buildComentariosFilaFilters(params, 1);
      const limitPlaceholder = `$${values.length + 1}`;
      values.push(params.limite + 1);

      const result = await db.query<ComentarioFilaRow>(`
        select ${comentarioColumns},
        a.elevenlabs_conversation_id as "conversationId",
        agente.nome as "agenteVozNome",
        a.iniciado_em as "iniciadoEm",
        a.concluido_em as "concluidoEm"
        ${comentarioFrom}
        join atendimentos a on a.id = c.atendimento_id
        join agentes_voz agente on agente.id = a.agente_voz_id
        where ${clauses.join(' and ')}
        order by c.criado_em, c.id
        limit ${limitPlaceholder}
      `, values);
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
