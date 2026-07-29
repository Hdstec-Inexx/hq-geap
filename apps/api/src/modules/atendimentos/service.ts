import {
  atendimentoDetailSchema,
  atendimentoSummarySchema,
  type AtendimentoDetail,
  type AtendimentoSummary
} from '@hq-geap/contracts/atendimentos';
import type { AtendimentoRow } from './repository.js';

function summaryValues(row: AtendimentoRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    agenteVoz: {
      id: row.agenteVozId,
      nome: row.agenteVozNome,
      agentId: row.agentId
    },
    status: row.status,
    iniciadoEm: row.iniciadoEm?.toISOString() ?? null,
    concluidoEm: row.concluidoEm?.toISOString() ?? null,
    duracaoSegundos: row.duracaoSegundos,
    motivoContato: row.motivoContato,
    houveTransferencia: row.houveTransferencia,
    custo: row.custo === null ? null : Number(row.custo)
  };
}

export function toAtendimentoSummary(row: AtendimentoRow): AtendimentoSummary {
  return atendimentoSummarySchema.parse(summaryValues(row));
}

export function toAtendimentoDetail(
  row: AtendimentoRow,
  audioUrl: string | null
): AtendimentoDetail {
  return atendimentoDetailSchema.parse({
    ...summaryValues(row),
    transcricao: row.transcricao ?? [],
    audioUrl
  });
}
