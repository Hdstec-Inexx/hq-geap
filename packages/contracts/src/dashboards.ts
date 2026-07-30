import { z } from 'zod';

const isoDateSchema = z.iso.date();
const percentageSchema = z.number().min(0).max(100).nullable();

export const dashboardPeriodSchema = z
  .object({
    inicio: isoDateSchema,
    fim: isoDateSchema
  })
  .refine(({ inicio, fim }) => inicio <= fim, {
    message: 'A data inicial deve ser anterior ou igual a data final'
  })
  .refine(
    ({ inicio, fim }) => {
      const maximumEnd = new Date(`${inicio}T00:00:00Z`);
      maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + 1);
      return fim <= maximumEnd.toISOString().slice(0, 10);
    },
    {
      message: 'O periodo do dashboard nao pode exceder um ano'
    }
  );

export const dashboardKpisSchema = z.object({
  volume: z.number().int().nonnegative(),
  tmaSegundos: z.number().nonnegative().nullable(),
  notaMediaIa: z.number().min(0).max(10).nullable(),
  notaMediaCurador: z.number().min(0).max(10).nullable(),
  transferencias: z.number().int().nonnegative(),
  resolvidosSemTransferencia: z.number().int().nonnegative(),
  custoTotal: z.number().nonnegative().nullable(),
  custoMedio: z.number().nonnegative().nullable()
});

export const dashboardSchema = z.object({
  periodo: dashboardPeriodSchema,
  kpis: dashboardKpisSchema,
  motivosContato: z.array(
    z.object({
      motivo: z.string(),
      total: z.number().int().positive()
    })
  ),
  criterios: z.array(
    z.object({
      criterioId: z.string().uuid(),
      chave: z.string(),
      nome: z.string(),
      atendidos: z.number().int().nonnegative(),
      avaliados: z.number().int().nonnegative(),
      percentualAcerto: percentageSchema
    })
  ),
  concordancia: z.object({
    nota: z.object({
      concordantes: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      percentual: percentageSchema
    }),
    criterios: z.object({
      concordantes: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      percentual: percentageSchema
    }),
    porCriterio: z.array(
      z.object({
        criterioId: z.string().uuid(),
        chave: z.string(),
        nome: z.string(),
        concordantes: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        percentual: percentageSchema
      })
    )
  }),
  pioresAtendimentos: z.array(
    z.object({
      id: z.string().uuid(),
      conversationId: z.string(),
      concluidoEm: z.iso.datetime(),
      motivoContato: z.string().nullable(),
      notaIa: z.number().min(0).max(10),
      notaCurador: z.number().min(0).max(10).nullable()
    })
  )
});

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
