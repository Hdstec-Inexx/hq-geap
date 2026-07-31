import { z } from 'zod';

export const estadoCriterioSchema = z.enum([
  'atendido',
  'nao_atendido',
  'nao_se_aplica'
]);

export const avaliacaoIaSchema = z.object({
  id: z.uuid(),
  atendimentoId: z.uuid(),
  nota: z.number().min(0).max(10),
  aprovacao: z.enum(['aprovado', 'reprovado']),
  falhasIdentificadas: z.array(z.string()),
  resumoAtendimento: z.string().nullable(),
  promptVersao: z.number().int().positive(),
  criadoEm: z.iso.datetime(),
  checklist: z.array(
    z.object({
      chave: z.string(),
      nome: z.string(),
      estado: estadoCriterioSchema,
      valor: z.number().nonnegative(),
      critico: z.boolean(),
      ordem: z.number().int()
    })
  )
});

export const avaliacaoIaResponseSchema = avaliacaoIaSchema.nullable();

export const avaliacaoCuradorResumoSchema = z.object({
  id: z.uuid(),
  atendimentoId: z.uuid(),
  autor: z.object({ id: z.uuid(), nome: z.string() }),
  nota: z.number().min(0).max(10),
  aprovacao: z.enum(['aprovado', 'reprovado']),
  criadoEm: z.iso.datetime(),
  checklist: z.array(
    z.object({
      chave: z.string(),
      nome: z.string(),
      estado: estadoCriterioSchema,
      valor: z.number().nonnegative(),
      critico: z.boolean(),
      ordem: z.number().int()
    })
  )
});

export const avaliacaoCuradorResponseSchema = avaliacaoCuradorResumoSchema.nullable();

export type EstadoCriterio = z.infer<typeof estadoCriterioSchema>;
export type AvaliacaoIa = z.infer<typeof avaliacaoIaSchema>;
export type AvaliacaoCuradorResumo = z.infer<typeof avaliacaoCuradorResumoSchema>;
