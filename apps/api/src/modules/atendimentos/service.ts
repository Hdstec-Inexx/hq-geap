import {
  atendimentoDetailSchema,
  atendimentoSummarySchema,
  normalizeTranscricao,
  type AtendimentoDetail,
  type AtendimentoSummary
} from '@hq-geap/contracts/atendimentos';
import { z } from 'zod';
import type { AtendimentoRow, AtendimentoSummaryRow } from './repository.js';

export { normalizeTranscricao };

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
  const custo =
    row.custo === null || row.custo === undefined ? null : Number(row.custo);
  const notaIa =
    row.notaIa === null || row.notaIa === undefined ? null : Number(row.notaIa);
  const curadoriaNota =
    row.curadoriaNota === null || row.curadoriaNota === undefined
      ? null
      : Number(row.curadoriaNota);
  const curadoriaRealizada = Boolean(row.curadorId);
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
    duracaoSegundos: (() => {
      if (row.duracaoSegundos === null || row.duracaoSegundos === undefined) {
        return null;
      }
      const value = Math.trunc(Number(row.duracaoSegundos));
      return Number.isFinite(value) && value >= 0 ? value : null;
    })(),
    motivoContato: row.motivoContato,
    houveTransferencia: Boolean(row.houveTransferencia),
    custo: custo !== null && Number.isFinite(custo) && custo >= 0 ? custo : null,
    notaIa:
      notaIa !== null && Number.isFinite(notaIa) && notaIa >= 0 && notaIa <= 10
        ? notaIa
        : null,
    curadoria: {
      realizada: curadoriaRealizada,
      curadorId: curadoriaRealizada ? row.curadorId : null,
      curadorNome: curadoriaRealizada ? row.curadorNome : null,
      nota:
        curadoriaRealizada &&
        curadoriaNota !== null &&
        Number.isFinite(curadoriaNota)
          ? curadoriaNota
          : null,
      realizadaEm: curadoriaRealizada
        ? toIsoDateTime(row.curadoriaRealizadaEm)
        : null
    }
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
    transcricao: normalizeTranscricao(row.transcricao),
    audioUrl: safeAudioUrl(audioUrl)
  });
}
