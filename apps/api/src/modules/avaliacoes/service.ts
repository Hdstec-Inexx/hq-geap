import {
  avaliacaoCuradorResumoSchema,
  avaliacaoIaSchema,
  type AvaliacaoCuradorResumo,
  type AvaliacaoIa,
  type ChecklistIaBooleano
} from '@hq-geap/contracts/avaliacoes';
import { derivarAprovacao } from './aprovacao.js';
import type { AvaliacaoCuradorResumoRow, AvaliacaoIaRow } from './repository.js';

function checklistValues(checklist: AvaliacaoIaRow['checklist']) {
  return checklist.map((criterio) => ({
    ...criterio,
    valor: Number(criterio.valor)
  }));
}

function checklistBooleano(row: AvaliacaoIaRow): ChecklistIaBooleano {
  return {
    saudacao_e_intencao: row.saudacaoEIntencao,
    solicitou_cpf: row.solicitouCpf,
    informou_protocolo_email: row.informouProtocoloEmail,
    resolveu_solicitacao: row.resolveuSolicitacao,
    validou_email_por_extenso: row.validouEmailPorExtenso,
    sem_diminutivos: row.semDiminutivos,
    encerramento_geap: row.encerramentoGeap,
    uso_correto_ferramentas: row.usoCorretoFerramentas
  };
}

export function toAvaliacaoIa(row: AvaliacaoIaRow): AvaliacaoIa {
  const nota = Number(row.nota);
  const checklist = checklistBooleano(row);
  return avaliacaoIaSchema.parse({
    id: row.id,
    atendimentoId: row.atendimentoId,
    nota,
    aprovacao: derivarAprovacao(nota, row.checklist),
    notaQualidade: Number(row.notaQualidade),
    atendimentoAprovado: row.atendimentoAprovado,
    falhasIdentificadas: row.falhasIdentificadas ?? [],
    resumoAtendimento: row.resumoAtendimento,
    promptVersao: row.promptVersao,
    criadoEm: row.criadoEm.toISOString(),
    checklist,
    criterios: row.checklist.map((criterio) => ({
      chave: criterio.chave,
      nome: criterio.nome,
      atendido: checklist[criterio.chave as keyof ChecklistIaBooleano] ?? false,
      valor: Number(criterio.valor),
      critico: criterio.critico,
      ordem: criterio.ordem
    }))
  });
}

export function toAvaliacaoCuradorResumo(
  row: AvaliacaoCuradorResumoRow
): AvaliacaoCuradorResumo {
  const nota = Number(row.nota);
  return avaliacaoCuradorResumoSchema.parse({
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
