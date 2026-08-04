import {
  atendimentoDetailSchema,
  atendimentoSummarySchema,
  type AtendimentoDetail,
  type AtendimentoSummary
} from '@hq-geap/contracts/atendimentos';
import { z } from 'zod';
import type { AtendimentoRow, AtendimentoSummaryRow } from './repository.js';

function toIsoDateTime(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeAudioUrl(audioUrl: string | null): string | null {
  if (!audioUrl) {
    return null;
  }
  return z.url().safeParse(audioUrl).success ? audioUrl : null;
}

function summaryValues(row: AtendimentoSummaryRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    agenteVoz: {
      id: row.agenteVozId,
      nome: row.agenteVozNome,
      agentId: row.agentId
    },
    status: row.status,
    iniciadoEm: toIsoDateTime(row.iniciadoEm),
    concluidoEm: toIsoDateTime(row.concluidoEm),
    duracaoSegundos: row.duracaoSegundos,
    motivoContato: row.motivoContato,
    houveTransferencia: row.houveTransferencia,
    custo: row.custo === null ? null : Number(row.custo)
  };
}

export function toAtendimentoSummary(row: AtendimentoSummaryRow): AtendimentoSummary {
  return atendimentoSummarySchema.parse(summaryValues(row));
}

export function toAtendimentoDetail(
  row: AtendimentoRow,
  audioUrl: string | null
): AtendimentoDetail {
  return atendimentoDetailSchema.parse({
    ...summaryValues(row),
    transcricao: row.transcricao ?? [],
    audioUrl: safeAudioUrl(audioUrl)
  });
}
