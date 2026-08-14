import { z } from 'zod';

const optionalNullableText = z.string().trim().min(1).nullable().optional();
const optionalNullableNonnegativeNumber = z.number().nonnegative().nullable().optional();
const storageReference = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((value) => !value.split('/').includes('..'));

export const transcriptEntrySchema = z.object({
  role: z.enum(['agent', 'user']),
  // ElevenLabs envia null em turnos só de tool_call; normalizamos para string vazia.
  message: z
    .string()
    .nullable()
    .transform((value) => value ?? ''),
  time_in_call_secs: z.number().nonnegative()
});

const toolExecutionsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    successful: z.number().int().nonnegative()
  })
  .refine(({ total, successful }) => successful <= total, {
    message: 'tools bem-sucedidas nao podem exceder o total'
  });

const ingestBaseSchema = z.object({
  conversation_id: z.string().trim().min(1),
  agent_id: z.string().trim().min(1),
  event_timestamp: z.number().int().nonnegative(),
  started_at: z.iso.datetime().nullable().optional(),
  transcript: z.array(transcriptEntrySchema),
  audio_reference: storageReference.nullable().optional(),
  contact_reason: optionalNullableText,
  transferred: z.boolean(),
  cost: optionalNullableNonnegativeNumber,
  tme_seconds: z.number().int().nonnegative().nullable().optional(),
  tool_executions: toolExecutionsSchema.optional()
});

export const ingestAtendimentoSchema = z.discriminatedUnion('status', [
  ingestBaseSchema.extend({
    status: z.literal('em_andamento'),
    completed_at: z.null().optional(),
    duration_seconds: optionalNullableNonnegativeNumber
  }),
  ingestBaseSchema.extend({
    status: z.literal('concluido'),
    completed_at: z.iso.datetime(),
    duration_seconds: z.number().int().nonnegative()
  })
]);

export const agenteVozSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  agentId: z.string()
});

export const atendimentoSummarySchema = z.object({
  id: z.uuid(),
  conversationId: z.string(),
  agenteVoz: agenteVozSchema,
  status: z.enum(['em_andamento', 'concluido']),
  iniciadoEm: z.iso.datetime().nullable(),
  concluidoEm: z.iso.datetime().nullable(),
  duracaoSegundos: z.number().int().nonnegative().nullable(),
  motivoContato: z.string().nullable(),
  houveTransferencia: z.boolean(),
  custo: z.number().nonnegative().nullable().optional()
});

export const atendimentoDetailSchema = atendimentoSummarySchema.extend({
  transcricao: z.array(transcriptEntrySchema),
  audioUrl: z.url().nullable()
});

export const atendimentoListSchema = z.object({
  items: z.array(atendimentoSummarySchema),
  total: z.number().int().min(0)
});

/** Dimensão do Detalhamento do Indicador (Dashboard → lista filtrada). */
export const detalhamentoIndicadorSchema = z.enum([
  'volume',
  'tma',
  'resolvidas',
  'sla',
  'nota_media_ia',
  'nota_media_curador',
  'promessas',
  'tempo_resolucao',
  'motivo',
  'criterio',
  'concordancia_nota',
  'concordancia_criterio'
]);

const isoDateSchema = z.iso.date();

export const atendimentosQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    status: z.enum(['em_andamento', 'concluido']).optional(),
    inicio: isoDateSchema.optional(),
    fim: isoDateSchema.optional(),
    indicador: detalhamentoIndicadorSchema.optional(),
    motivo: z.string().trim().min(1).max(200).optional(),
    criterioId: z.uuid().optional()
  })
  .superRefine((query, ctx) => {
    const hasPeriod = query.inicio !== undefined || query.fim !== undefined;
    if (query.indicador !== undefined && (!query.inicio || !query.fim)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Detalhamento exige periodo inicio/fim',
        path: ['inicio']
      });
      return;
    }
    if (hasPeriod && (!query.inicio || !query.fim)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Periodo incompleto: informe inicio e fim',
        path: query.inicio ? ['fim'] : ['inicio']
      });
      return;
    }
    if (query.inicio && query.fim) {
      if (query.inicio > query.fim) {
        ctx.addIssue({
          code: 'custom',
          message: 'A data inicial deve ser anterior ou igual a data final',
          path: ['inicio']
        });
      }
      const maximumEnd = new Date(`${query.inicio}T00:00:00Z`);
      maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + 1);
      if (query.fim > maximumEnd.toISOString().slice(0, 10)) {
        ctx.addIssue({
          code: 'custom',
          message: 'O periodo nao pode exceder um ano',
          path: ['fim']
        });
      }
    }
    if (query.indicador === 'motivo' && !query.motivo) {
      ctx.addIssue({
        code: 'custom',
        message: 'indicador=motivo exige o parametro motivo',
        path: ['motivo']
      });
    }
    if (
      (query.indicador === 'criterio' ||
        query.indicador === 'concordancia_criterio') &&
      !query.criterioId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${query.indicador} exige criterioId`,
        path: ['criterioId']
      });
    }
  });

export type DetalhamentoIndicador = z.infer<typeof detalhamentoIndicadorSchema>;
export type AtendimentosQuery = z.infer<typeof atendimentosQuerySchema>;
export type IngestAtendimento = z.infer<typeof ingestAtendimentoSchema>;
export type AtendimentoSummary = z.infer<typeof atendimentoSummarySchema>;
export type AtendimentoList = z.infer<typeof atendimentoListSchema>;
export type AtendimentoDetail = z.infer<typeof atendimentoDetailSchema>;
