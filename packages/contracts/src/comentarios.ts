import { z } from 'zod';

export const statusComentarioSchema = z.enum(['pendente', 'resolvido']);

export const comentarioSchema = z.object({
  id: z.uuid(),
  atendimentoId: z.uuid(),
  texto: z.string(),
  status: statusComentarioSchema,
  autor: z.object({
    id: z.uuid(),
    nome: z.string()
  }),
  resolucao: z
    .object({
      responsavel: z.object({
        id: z.uuid(),
        nome: z.string()
      }),
      resolvidoEm: z.iso.datetime()
    })
    .nullable(),
  criadoEm: z.iso.datetime()
});

export const comentariosSchema = z.array(comentarioSchema);

const isoDateSchema = z.iso.date();

function refinePeriodo(
  query: { inicio?: string; fim?: string },
  ctx: z.RefinementCtx
) {
  if (!query.inicio && query.fim) {
    ctx.addIssue({
      code: 'custom',
      message: 'Periodo incompleto: informe inicio',
      path: ['inicio']
    });
    return;
  }
  const effectiveFim = query.fim ?? query.inicio;
  if (query.inicio && effectiveFim) {
    if (query.inicio > effectiveFim) {
      ctx.addIssue({
        code: 'custom',
        message: 'A data inicial deve ser anterior ou igual a data final',
        path: ['inicio']
      });
    }
    const maximumEnd = new Date(`${query.inicio}T00:00:00Z`);
    if (!Number.isNaN(maximumEnd.getTime())) {
      maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + 1);
      if (effectiveFim > maximumEnd.toISOString().slice(0, 10)) {
        ctx.addIssue({
          code: 'custom',
          message: 'O periodo nao pode exceder um ano',
          path: ['fim']
        });
      }
    }
  }
}

function transformPeriodo<T extends { inicio?: string; fim?: string }>(query: T): T {
  if (query.inicio && !query.fim) {
    return { ...query, fim: query.inicio };
  }
  return query;
}

export const comentarioFilaSchema = comentarioSchema.extend({
  atendimento: z.object({
    id: z.uuid(),
    conversationId: z.string(),
    agenteVozNome: z.string(),
    iniciadoEm: z.iso.datetime().nullable(),
    concluidoEm: z.iso.datetime().nullable()
  })
});

export const comentariosFilaSchema = z.array(comentarioFilaSchema);

export const comentariosFilaPageSchema = z.object({
  items: comentariosFilaSchema,
  nextCursor: z.uuid().nullable()
});

export const criarComentarioSchema = z.object({
  texto: z.string().trim().min(1).max(4000)
});

export const atualizarStatusComentarioSchema = z.object({
  status: z.literal('resolvido')
});

export const filtroStatusComentarioSchema = z
  .object({
    status: statusComentarioSchema.default('pendente'),
    cursor: z.uuid().optional(),
    limite: z.coerce.number().int().min(1).max(100).default(50),
    inicio: isoDateSchema.optional(),
    fim: isoDateSchema.optional(),
    conversationId: z.string().trim().min(1).max(200).optional()
  })
  .superRefine(refinePeriodo)
  .transform(transformPeriodo);

export type StatusComentario = z.infer<typeof statusComentarioSchema>;
export type Comentario = z.infer<typeof comentarioSchema>;
export type ComentarioFila = z.infer<typeof comentarioFilaSchema>;
export type ComentariosFilaPage = z.infer<typeof comentariosFilaPageSchema>;
export type CriarComentario = z.infer<typeof criarComentarioSchema>;
export type FiltroStatusComentario = z.infer<typeof filtroStatusComentarioSchema>;
