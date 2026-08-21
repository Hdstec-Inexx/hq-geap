import { z } from 'zod';

export const criterioSchema = z.object({
  id: z.uuid().optional(),
  chave: z.string().trim().min(1),
  nome: z.string().trim().min(1),
  descricao: z.string().trim().min(1).nullable(),
  valor: z.number().nonnegative().max(10).multipleOf(0.01),
  critico: z.boolean(),
  condicional: z.boolean(),
  ordem: z.number().int().positive()
});

export const reguaAvaliacaoSchema = z
  .object({
    vigente: z.literal(true),
    total: z.literal(10),
    limiarAprovacao: z.literal(7),
    criterios: z.array(criterioSchema).min(1)
  })
  .superRefine((regua, context) => {
    const totalEmCentavos = regua.criterios.reduce(
      (total, criterio) => total + Math.round(criterio.valor * 100),
      0
    );
    if (totalEmCentavos !== 1_000) {
      context.addIssue({
        code: 'custom',
        message: 'Os critérios da Régua vigente devem somar exatamente 10',
        path: ['criterios']
      });
    }

    for (let index = 0; index < regua.criterios.length; index += 1) {
      if (regua.criterios[index]!.ordem !== index + 1) {
        context.addIssue({
          code: 'custom',
          message: 'Os critérios devem ter ordem sequencial e única',
          path: ['criterios', index, 'ordem']
        });
      }
    }
  });

export type Criterio = z.infer<typeof criterioSchema>;
export type ReguaAvaliacao = z.infer<typeof reguaAvaliacaoSchema>;
