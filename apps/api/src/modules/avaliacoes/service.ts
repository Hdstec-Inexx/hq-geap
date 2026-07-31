import {
  avaliacaoCuradorResumoSchema,
  avaliacaoIaSchema,
  type AvaliacaoCuradorResumo,
  type AvaliacaoIa
} from '@hq-geap/contracts/avaliacoes';
import { derivarAprovacao } from './aprovacao.js';
import type { AvaliacaoCuradorResumoRow, AvaliacaoIaRow } from './repository.js';

function checklistValues(checklist: AvaliacaoIaRow['checklist']) {
  return checklist.map((criterio) => ({
    ...criterio,
    valor: Number(criterio.valor)
  }));
}

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
    checklist: checklistValues(row.checklist)
  });
}

export function toAvaliacaoCuradorResumo(
  row: AvaliacaoCuradorResumoRow
): AvaliacaoCuradorResumo {
  const nota = Number(row.nota);
  return avaliacaoCuradorResumoSchema.parse({
    id: row.id,
    atendimentoId: row.atendimentoId,
    autor: { id: row.autorId, nome: row.autorNome },
    nota,
    aprovacao: derivarAprovacao(nota, row.checklist),
    criadoEm: row.criadoEm.toISOString(),
    checklist: checklistValues(row.checklist)
  });
}
