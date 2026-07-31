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

export const comentarioFilaSchema = comentarioSchema.extend({
  atendimento: z.object({
    id: z.uuid(),
    conversationId: z.string(),
    agenteVozNome: z.string()
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

export const filtroStatusComentarioSchema = z.object({
  status: statusComentarioSchema.default('pendente'),
  cursor: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50)
});

export type StatusComentario = z.infer<typeof statusComentarioSchema>;
export type Comentario = z.infer<typeof comentarioSchema>;
export type ComentarioFila = z.infer<typeof comentarioFilaSchema>;
export type ComentariosFilaPage = z.infer<typeof comentariosFilaPageSchema>;
export type CriarComentario = z.infer<typeof criarComentarioSchema>;
