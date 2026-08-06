import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';
import {
  avaliacaoCuradorSchema,
  curadoriaDetailSchema,
  filaCuradoriaItemSchema,
  type AvaliacaoCurador,
  type CuradoriaDetail,
  type FilaCuradoriaItem
} from '@hq-geap/contracts/curadoria';
import { toAtendimentoDetail } from '../atendimentos/service.js';
import { derivarAprovacao } from '../avaliacoes/aprovacao.js';
import { toAvaliacaoIa } from '../avaliacoes/service.js';
import type {
  AvaliacaoCuradorRow,
  CuradoriaAtendimentoRow,
  FilaCuradoriaRow
} from './repository.js';

export type CriterioConferencia = {
  criterioId: string;
  chave: string;
  nome: string;
  estado: EstadoCriterio;
  valor: string;
  critico: boolean;
  condicional: boolean;
  ordem: number;
};

type EstadoInformado = {
  chave: string;
  estado: EstadoCriterio;
};

export function calcularConferencia(
  checklistIa: CriterioConferencia[],
  estadosInformados: EstadoInformado[]
) {
  const estados = new Map(
    estadosInformados.map(({ chave, estado }) => [chave, estado])
  );
  if (
    estados.size !== checklistIa.length ||
    estadosInformados.length !== checklistIa.length ||
    checklistIa.some(({ chave }) => !estados.has(chave))
  ) {
    throw new Error('A conferencia deve conter todos os Criterios da IA');
  }

  const ferramentasNaoAtendidas =
    estados.get('uso_correto_ferramentas') === 'nao_atendido';

  const checklist = checklistIa.map((criterio) => {
    let estado = estados.get(criterio.chave)!;
    if (
      ferramentasNaoAtendidas &&
      criterio.chave === 'resolveu_solicitacao' &&
      estado !== 'nao_atendido'
    ) {
      estado = 'nao_atendido';
    }
    if (estado === 'nao_se_aplica' && !criterio.condicional) {
      throw new Error('Nao se aplica exige um Criterio condicional');
    }
    return { ...criterio, estado };
  });
  const nota = checklist.reduce(
    (total, criterio) =>
      total + (criterio.estado === 'nao_atendido' ? 0 : Number(criterio.valor)),
    0
  );

  return {
    checklist,
    nota,
    aprovacao: derivarAprovacao(nota, checklist)
  };
}

function checklistValues(checklist: CriterioConferencia[]) {
  return checklist.map(({ criterioId: _criterioId, ...criterio }) => ({
    ...criterio,
    valor: Number(criterio.valor)
  }));
}

export function toFilaCuradoriaItem(row: FilaCuradoriaRow): FilaCuradoriaItem {
  return filaCuradoriaItemSchema.parse({
    ...row,
    concluidoEm: row.concluidoEm.toISOString(),
    notaIa: Number(row.notaIa)
  });
}

export function toAvaliacaoCurador(row: AvaliacaoCuradorRow): AvaliacaoCurador {
  const nota = Number(row.nota);
  return avaliacaoCuradorSchema.parse({
    id: row.id,
    atendimentoId: row.atendimentoId,
    avaliacaoIaId: row.avaliacaoIaId,
    autor: { id: row.autorId, nome: row.autorNome },
    nota,
    aprovacao: derivarAprovacao(nota, row.checklist),
    falhasIdentificadas: row.falhasIdentificadas,
    resumoAtendimento: row.resumoAtendimento,
    notaAvaliacaoIa: Number(row.notaAvaliacaoIa),
    comentario: row.comentario,
    criadoEm: row.criadoEm.toISOString(),
    checklist: checklistValues(row.checklist)
  });
}

export function toCuradoriaDetail(
  row: CuradoriaAtendimentoRow,
  audioUrl: string | null
): CuradoriaDetail {
  const historico = row.historico.map(toAvaliacaoCurador);
  const avaliacaoIa = toAvaliacaoIa(row.avaliacaoIa);
  return curadoriaDetailSchema.parse({
    atendimento: toAtendimentoDetail(row, audioUrl),
    avaliacaoIa: {
      ...avaliacaoIa,
      checklist: checklistValues(row.avaliacaoIa.checklist)
    },
    avaliacaoMaisRecente: historico[0] ?? null,
    historico
  });
}
