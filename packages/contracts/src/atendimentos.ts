import { z } from 'zod';

const optionalNullableUrl = z.url().nullable().optional();
const optionalNullableText = z.string().trim().min(1).nullable().optional();
const optionalNullableNonnegativeNumber = z.number().nonnegative().nullable().optional();

export const transcriptEntrySchema = z.object({
  role: z.enum(['agent', 'user']),
  message: z.string(),
  time_in_call_secs: z.number().nonnegative()
});

const ingestBaseSchema = z.object({
  conversation_id: z.string().trim().min(1),
  agent_id: z.string().trim().min(1),
  started_at: z.iso.datetime().nullable().optional(),
  transcript: z.array(transcriptEntrySchema),
  audio_url: optionalNullableUrl,
  contact_reason: optionalNullableText,
  transferred: z.boolean(),
  cost: optionalNullableNonnegativeNumber
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

export const atendimentoListSchema = z.array(atendimentoSummarySchema);

export type IngestAtendimento = z.infer<typeof ingestAtendimentoSchema>;
export type AtendimentoSummary = z.infer<typeof atendimentoSummarySchema>;
export type AtendimentoDetail = z.infer<typeof atendimentoDetailSchema>;
