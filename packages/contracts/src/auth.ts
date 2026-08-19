import { z } from 'zod';

export const userRoleSchema = z.enum(['admin', 'gestao', 'curador']);

export const sessionIdentitySchema = z
  .object({
    id: z.uuid()
  })
  .strict();

export const perfilSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: userRoleSchema
});

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1)
});

export const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: sessionIdentitySchema
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
export type Perfil = z.infer<typeof perfilSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Admin and Gestão may download audio files; Curador is restricted. */
export function canDownloadAudio(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'gestao';
}

