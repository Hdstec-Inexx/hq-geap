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

export const listUsuariosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const listUsuariosResponseSchema = z.object({
  users: z.array(usuarioSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0)
});

const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => new TextEncoder().encode(password).length <= 72, {
    message: 'Password must not exceed 72 UTF-8 bytes'
  });

export const createUsuarioSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: passwordSchema,
  role: userRoleSchema
});

export const updateUsuarioSchema = createUsuarioSchema.omit({ password: true });

export const setUsuarioPasswordSchema = z.object({
  password: passwordSchema
});

export type Usuario = z.infer<typeof usuarioSchema>;
export type ListUsuariosQuery = z.infer<typeof listUsuariosQuerySchema>;
export type ListUsuariosResponse = z.infer<typeof listUsuariosResponseSchema>;
export type CreateUsuario = z.infer<typeof createUsuarioSchema>;
export type UpdateUsuario = z.infer<typeof updateUsuarioSchema>;
export type SetUsuarioPassword = z.infer<typeof setUsuarioPasswordSchema>;
