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

function parseTranscriptPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Normaliza transcrição suja (ex.: raw_transcript da ElevenLabs gravado direto no Postgres). */
export function normalizeTranscricao(raw: unknown) {
  const entries: Array<{
    role: 'agent' | 'user';
    message: string;
    time_in_call_secs: number;
  }> = [];

  for (const entry of parseTranscriptPayload(raw)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const { role, message, time_in_call_secs } = entry as {
      role?: unknown;
      message?: unknown;
      time_in_call_secs?: unknown;
    };
    if (role !== 'agent' && role !== 'user') {
      continue;
    }
    const time =
      typeof time_in_call_secs === 'number'
        ? time_in_call_secs
        : typeof time_in_call_secs === 'string'
          ? Number(time_in_call_secs)
          : Number.NaN;
    if (!Number.isFinite(time) || time < 0) {
      continue;
    }
    if (message != null && typeof message !== 'string') {
      continue;
    }
    entries.push({
      role,
      message: message ?? '',
      time_in_call_secs: time
    });
  }

  return entries;
}

function summaryValues(row: AtendimentoSummaryRow) {
  const custo =
    row.custo === null || row.custo === undefined ? null : Number(row.custo);
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
    custo: custo !== null && Number.isFinite(custo) && custo >= 0 ? custo : null
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
