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

export const criarComentarioSchema = z.object({
  texto: z.string().trim().min(1).max(4000)
});

export const atualizarStatusComentarioSchema = z.object({
  status: z.literal('resolvido')
});

export const filtroStatusComentarioSchema = z.object({
  status: statusComentarioSchema.default('pendente')
});

export type StatusComentario = z.infer<typeof statusComentarioSchema>;
export type Comentario = z.infer<typeof comentarioSchema>;
export type ComentarioFila = z.infer<typeof comentarioFilaSchema>;
export type CriarComentario = z.infer<typeof criarComentarioSchema>;
