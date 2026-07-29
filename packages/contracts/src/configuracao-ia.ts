import { z } from 'zod';

const requiredText = z.string().trim().min(1);
const providerIdentifier = requiredText.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const modelIdentifier = requiredText.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

export const publishConfiguracaoIaSchema = z.object({
  prompt: requiredText,
  provider: providerIdentifier,
  model: modelIdentifier,
  temperature: z.number().min(0).max(2).multipleOf(0.1)
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
