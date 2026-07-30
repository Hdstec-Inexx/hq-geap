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

export const filaCuradoriaSchema = z.array(filaCuradoriaItemSchema);

export const avaliacaoCuradorSchema = z.object({
  id: z.uuid(),
  atendimentoId: z.uuid(),
  autor: z.object({ id: z.uuid(), nome: z.string() }),
  nota: z.number().min(0).max(10),
  aprovacao: z.enum(['aprovado', 'reprovado']),
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
  )
});

export type FilaCuradoriaItem = z.infer<typeof filaCuradoriaItemSchema>;
export type AvaliacaoCurador = z.infer<typeof avaliacaoCuradorSchema>;
export type CuradoriaDetail = z.infer<typeof curadoriaDetailSchema>;
export type SalvarConferencia = z.infer<typeof salvarConferenciaSchema>;
