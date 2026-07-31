import { z } from 'zod';

export const monitoramentoEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready')
  }),
  z.object({
    type: z.literal('transcript'),
    role: z.enum(['agent', 'user']),
    message: z.string()
  }),
  z.object({
    type: z.literal('correction'),
    message: z.string()
  }),
  z.object({
    type: z.literal('ended')
  }),
  z.object({
    type: z.literal('error'),
    message: z.string()
  })
]);

export type MonitoramentoEvent = z.infer<typeof monitoramentoEventSchema>;
