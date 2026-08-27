import type { EstadoCriterio } from '@hq-geap/contracts/avaliacoes';
import type { AvaliacaoCurador } from '@hq-geap/contracts/curadoria';
import { canWriteAsCurador, type UserRole } from '@hq-geap/contracts/auth';

export interface ReviewFormInitialState {
  estados: Record<string, EstadoCriterio>;
  notaAvaliacaoIa: string;
  falhasIdentificadas: string;
  resumoAtendimento: string;
  comentario: string;
}

export function shouldShowReadingCardFirst(
  role: UserRole | null | undefined,
  avaliacaoMaisRecente: AvaliacaoCurador | null | undefined
): boolean {
  if (!canWriteAsCurador(role)) {
    return true;
  }
  return avaliacaoMaisRecente !== null && avaliacaoMaisRecente !== undefined;
}

export function getInitialReviewFormState(
  avaliacaoIa: {
    nota: number;
    checklist: Array<{ chave: string; estado: EstadoCriterio }>;
    falhasIdentificadas: string[];
    resumoAtendimento?: string | null;
  },
  avaliacaoMaisRecente?: AvaliacaoCurador | null
): ReviewFormInitialState {
  if (avaliacaoMaisRecente) {
    const estados = Object.fromEntries(
      avaliacaoMaisRecente.checklist.map(({ chave, estado }) => [chave, estado])
    );
    for (const criterio of avaliacaoIa.checklist) {
      if (!(criterio.chave in estados)) {
        estados[criterio.chave] = criterio.estado;
      }
    }

    return {
      estados,
      notaAvaliacaoIa: String(avaliacaoMaisRecente.notaAvaliacaoIa),
      falhasIdentificadas: avaliacaoMaisRecente.falhasIdentificadas.join('\n'),
      resumoAtendimento: avaliacaoMaisRecente.resumoAtendimento ?? '',
      comentario: avaliacaoMaisRecente.comentario ?? ''
    };
  }

  return {
    estados: Object.fromEntries(
      avaliacaoIa.checklist.map(({ chave, estado }) => [chave, estado])
    ),
    notaAvaliacaoIa: String(avaliacaoIa.nota),
    falhasIdentificadas: avaliacaoIa.falhasIdentificadas.join('\n'),
    resumoAtendimento: avaliacaoIa.resumoAtendimento ?? '',
    comentario: ''
  };
}
