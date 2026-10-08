import { z } from 'zod';
import { atendimentoSummarySchema, favoritoPerfilSchema } from './atendimentos.js';

export const favoritosQuerySchema = z.object({
  agenteVozId: z.uuid().optional(),
  conversationId: z.string().trim().min(1).max(200).optional(),
  perfilId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

export const favoritoCuradorItemSchema = atendimentoSummarySchema.extend({
  favoritadoEm: z.iso.datetime()
});

export const favoritoGestaoItemSchema = atendimentoSummarySchema.extend({
  ultimoFavoritadoEm: z.iso.datetime(),
  favoritadoEm: z.iso.datetime().optional(),
  favoritos: z.object({
    count: z.number().int().min(1),
    perfis: z.array(favoritoPerfilSchema)
  })
});

export const favoritosCuradorSchema = z.object({
  items: z.array(favoritoCuradorItemSchema),
  total: z.number().int().min(0)
});

export const favoritosGestaoSchema = z.object({
  items: z.array(favoritoGestaoItemSchema),
  total: z.number().int().min(0)
});

export const agentesVozListSchema = z.array(z.object({
  id: z.uuid(),
  nome: z.string()
}));

export type FavoritosQuery = z.infer<typeof favoritosQuerySchema>;
export type FavoritoCuradorItem = z.infer<typeof favoritoCuradorItemSchema>;
export type FavoritoGestaoItem = z.infer<typeof favoritoGestaoItemSchema>;
export type FavoritosCurador = z.infer<typeof favoritosCuradorSchema>;
export type FavoritosGestao = z.infer<typeof favoritosGestaoSchema>;
