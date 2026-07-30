import {
  avaliacaoIaSchema,
  type AvaliacaoIa
} from '@hq-geap/contracts/avaliacoes';
import { derivarAprovacao } from './aprovacao.js';
import type { AvaliacaoIaRow } from './repository.js';

export function toAvaliacaoIa(row: AvaliacaoIaRow): AvaliacaoIa {
  const nota = Number(row.nota);
  return avaliacaoIaSchema.parse({
    id: row.id,
    atendimentoId: row.atendimentoId,
    nota,
    aprovacao: derivarAprovacao(nota, row.checklist),
    falhasIdentificadas: row.falhasIdentificadas ?? [],
    resumoAtendimento: row.resumoAtendimento,
    promptVersao: row.promptVersao,
    criadoEm: row.criadoEm.toISOString(),
    checklist: row.checklist.map((criterio) => ({
      ...criterio,
      valor: Number(criterio.valor)
    }))
  });
}
