import { z } from 'zod';

export const monitoramentoAuthMessageSchema = z.object({
  type: z.literal('auth'),
  token: z.string().trim().min(1)
});

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

export type MonitoramentoAuthMessage = z.infer<typeof monitoramentoAuthMessageSchema>;
export type MonitoramentoEvent = z.infer<typeof monitoramentoEventSchema>;
