import { z } from 'zod';

export const monitoramentoAuthMessageSchema = z.object({
  type: z.literal('auth'),
  token: z.string().trim().min(1).max(8_192)
});

export const conversationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const monitoramentoConversaSchema = z.object({
  conversationId: z.string().min(1),
  agentId: z.string().min(1),
  agenteVozNome: z.string().nullable(),
  status: z.enum(['initiated', 'in-progress']),
  iniciadoEm: z.string().datetime().nullable()
});

export const monitoramentoConversasSchema = z.array(monitoramentoConversaSchema);

export const monitoramentoEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready')
  }),
  z.object({
    type: z.literal('transcript'),
    role: z.enum(['agent', 'user']),
    message: z.string().max(4_096)
  }),
  z.object({
    type: z.literal('correction'),
    message: z.string().max(4_096)
  }),
  z.object({
    type: z.literal('ended')
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().max(1_024)
  })
]);

export type MonitoramentoAuthMessage = z.infer<typeof monitoramentoAuthMessageSchema>;
export type MonitoramentoConversa = z.infer<typeof monitoramentoConversaSchema>;
export type MonitoramentoEvent = z.infer<typeof monitoramentoEventSchema>;
