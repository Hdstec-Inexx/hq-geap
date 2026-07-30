import { z } from 'zod';
import { userRoleSchema } from './auth.js';

export const usuarioSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: userRoleSchema,
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const createUsuarioSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(72),
  role: userRoleSchema
});

export const updateUsuarioSchema = createUsuarioSchema.omit({ password: true });

export type Usuario = z.infer<typeof usuarioSchema>;
export type CreateUsuario = z.infer<typeof createUsuarioSchema>;
export type UpdateUsuario = z.infer<typeof updateUsuarioSchema>;
