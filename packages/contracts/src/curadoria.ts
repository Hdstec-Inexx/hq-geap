import { z } from 'zod';
import { atendimentoDetailSchema } from './atendimentos.js';
import { avaliacaoIaSchema, estadoCriterioSchema } from './avaliacoes.js';

export const criterioCuradoriaSchema = z.object({
  chave: z.string(),
  nome: z.string(),
  estado: estadoCriterioSchema,
  valor: z.number().nonnegative(),
  critico: z.boolean(),
  condicional: z.boolean(),
  ordem: z.number().int()
});

export const filaCuradoriaItemSchema = z.object({
  id: z.uuid(),
  conversationId: z.string(),
  agenteVozNome: z.string(),
  concluidoEm: z.iso.datetime(),
  duracaoSegundos: z.number().int().nonnegative().nullable(),
  motivoContato: z.string().nullable(),
  notaIa: z.number().min(0).max(10)
});

export const filaCuradoriaSchema = z.object({
  items: z.array(filaCuradoriaItemSchema),
  total: z.number().int().min(0)
});

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

export const filaCuradoriaQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    inicio: isoDateSchema.optional(),
    fim: isoDateSchema.optional(),
    motivo: z.string().trim().min(1).max(200).optional()
  })
  .superRefine(refinePeriodo)
  .transform(transformPeriodo);


export const avaliacaoCuradorSchema = z.object({
  id: z.uuid(),
  atendimentoId: z.uuid(),
  avaliacaoIaId: z.uuid(),
  autor: z.object({ id: z.uuid(), nome: z.string() }),
  nota: z.number().min(0).max(10),
  aprovacao: z.enum(['aprovado', 'reprovado']),
  falhasIdentificadas: z.array(z.string()),
  resumoAtendimento: z.string().nullable(),
  notaAvaliacaoIa: z.number().min(0).max(10),
  comentario: z.string().nullable(),
  criadoEm: z.iso.datetime(),
  checklist: z.array(criterioCuradoriaSchema)
});

export const avaliacaoIaCuradoriaSchema = avaliacaoIaSchema.extend({
  checklist: z.array(criterioCuradoriaSchema)
});

export const curadoriaDetailSchema = z.object({
  atendimento: atendimentoDetailSchema,
  avaliacaoIa: avaliacaoIaCuradoriaSchema,
  avaliacaoMaisRecente: avaliacaoCuradorSchema.nullable(),
  historico: z.array(avaliacaoCuradorSchema)
});

export const salvarConferenciaSchema = z.object({
  checklist: z.array(
    z.object({
      chave: z.string().trim().min(1),
      estado: estadoCriterioSchema
    })
  ),
  notaAvaliacaoIa: z.number().min(0).max(10),
  falhasIdentificadas: z.array(z.string()).default([]),
  resumoAtendimento: z.string().nullable().optional(),
  comentario: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null))
});

export const curadorItemSchema = z.object({
  id: z.uuid(),
  nome: z.string()
});

export const curadoresListSchema = z.array(curadorItemSchema);

export const curadoriasRealizadasQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    inicio: isoDateSchema.optional(),
    fim: isoDateSchema.optional(),
    motivo: z.string().trim().min(1).max(200).optional(),
    curadorId: z.uuid().optional()
  })
  .superRefine(refinePeriodo)
  .transform(transformPeriodo);


export const curadoriaRealizadaItemSchema = z.object({
  id: z.uuid(),
  conversationId: z.string(),
  agenteVozNome: z.string(),
  concluidoEm: z.iso.datetime(),
  duracaoSegundos: z.number().int().nonnegative().nullable(),
  motivoContato: z.string().nullable(),
  notaIa: z.number().min(0).max(10),
  curadorId: z.uuid(),
  curadorNome: z.string(),
  notaCurador: z.number().min(0).max(10),
  realizadaEm: z.iso.datetime()
});

export const curadoriasRealizadasPageSchema = z.object({
  items: z.array(curadoriaRealizadaItemSchema),
  total: z.number().int().min(0)
});

export type FilaCuradoriaItem = z.infer<typeof filaCuradoriaItemSchema>;
export type FilaCuradoriaPage = z.infer<typeof filaCuradoriaSchema>;
export type FilaCuradoriaQuery = z.infer<typeof filaCuradoriaQuerySchema>;
export type CuradoriasRealizadasQuery = z.infer<typeof curadoriasRealizadasQuerySchema>;
export type CuradoriaRealizadaItem = z.infer<typeof curadoriaRealizadaItemSchema>;
export type CuradoriasRealizadasPage = z.infer<typeof curadoriasRealizadasPageSchema>;
export type AvaliacaoCurador = z.infer<typeof avaliacaoCuradorSchema>;
export type CuradoriaDetail = z.infer<typeof curadoriaDetailSchema>;
export type SalvarConferencia = z.infer<typeof salvarConferenciaSchema>;
export type CuradorItem = z.infer<typeof curadorItemSchema>;

