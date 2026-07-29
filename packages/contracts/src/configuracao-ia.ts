import { z } from 'zod';

const requiredText = z.string().trim().min(1);

export const publishConfiguracaoIaSchema = z.object({
  prompt: requiredText,
  provider: requiredText,
  model: requiredText,
  temperature: z.number().min(0).max(2)
});

export const configuracaoIaSchema = publishConfiguracaoIaSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  active: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime()
});

export type PublishConfiguracaoIa = z.infer<typeof publishConfiguracaoIaSchema>;
export type ConfiguracaoIa = z.infer<typeof configuracaoIaSchema>;
