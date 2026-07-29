import { z } from 'zod';

export const userRoleSchema = z.enum(['admin', 'gestao', 'curador']);

export const sessionUserSchema = z.object({
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
  user: sessionUserSchema
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
