import { z } from 'zod';

const optionalNullableText = z.string().trim().min(1).nullable().optional();
const optionalNullableNonnegativeNumber = z.number().nonnegative().nullable().optional();
const storageReference = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((value) => !value.split('/').includes('..'));

export function roleFromSpeaker(speaker: unknown): 'agent' | 'user' | null {
  if (typeof speaker !== 'string') {
    return null;
  }
  const normalized = speaker.trim().toLowerCase();
  if (
    normalized === 'ia' ||
    normalized === 'agent' ||
    normalized === 'assistente' ||
    normalized === 'agente'
  ) {
    return 'agent';
  }
  if (
    normalized === 'cliente' ||
    normalized === 'user' ||
    normalized === 'usuario' ||
    normalized === 'usuário'
  ) {
    return 'user';
  }
  return null;
}

export type TranscriptEntry = {
  role: 'agent' | 'user';
  message: string;
  time_in_call_secs: number;
};

export type HistoricoTurn = {
  speaker: 'IA' | 'Cliente';
  message: string;
  tempo_segundos: number;
  tempo_formatado: string;
};

export type HistoricoTranscricao = {
  historico: HistoricoTurn[];
};

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function resolveToolName(item: Record<string, unknown>): string | null {
  const name = item.tool_name ?? item.name ?? item.toolName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export function normalizeTranscriptEntry(
  raw: unknown,
  toolNamesById?: Map<string, string>
): TranscriptEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const resolvedRole =
    entry.role === 'agent' || entry.role === 'user'
      ? entry.role
      : (roleFromSpeaker(entry.role) ?? roleFromSpeaker(entry.speaker));

  if (!resolvedRole) {
    return null;
  }

  const rawTime =
    entry.time_in_call_secs !== undefined && entry.time_in_call_secs !== null
      ? entry.time_in_call_secs
      : entry.tempo_segundos;

  let time = 0;
  if (typeof rawTime === 'number') {
    time = rawTime;
  } else if (typeof rawTime === 'string') {
    const trimmed = rawTime.trim();
    if (trimmed === '') {
      time = 0;
    } else {
      time = Number(trimmed);
    }
  } else if (rawTime !== undefined && rawTime !== null) {
    return null;
  }

  if (!Number.isFinite(time) || time < 0) {
    return null;
  }

  const verbalText = typeof entry.message === 'string' ? entry.message.trim() : '';

  const toolCallLines: string[] = [];
  if (Array.isArray(entry.tool_calls)) {
    for (const call of entry.tool_calls) {
      if (!call || typeof call !== 'object') continue;
      const callRecord = call as Record<string, unknown>;
      if (callRecord.tool_has_been_called === false) continue;
      const toolName = resolveToolName(callRecord);
      if (toolName) {
        toolCallLines.push(`[Chamada de Ferramenta: ${toolName}]`);
      }
    }
  }

  const toolResultLines: string[] = [];
  if (Array.isArray(entry.tool_results)) {
    for (const result of entry.tool_results) {
      if (!result || typeof result !== 'object') continue;
      const resultRecord = result as Record<string, unknown>;
      let toolName = resolveToolName(resultRecord);
      const callId =
        typeof resultRecord.tool_call_id === 'string' ? resultRecord.tool_call_id : null;
      if (!toolName && callId && toolNamesById?.has(callId)) {
        toolName = toolNamesById.get(callId) ?? null;
      }
      if (!toolName && callId && Array.isArray(entry.tool_calls)) {
        const matchingCall = entry.tool_calls.find(
          (callItem) =>
            callItem &&
            typeof callItem === 'object' &&
            (callItem as Record<string, unknown>).tool_call_id === callId
        ) as Record<string, unknown> | undefined;
        if (matchingCall) {
          toolName = resolveToolName(matchingCall);
        }
      }
      if (toolName) {
        const isError =
          resultRecord.is_error === true ||
          Boolean(resultRecord.error) ||
          resultRecord.status === 'error' ||
          resultRecord.status === 'failure' ||
          resultRecord.status === 'Falha';
        const status = isError ? 'Falha' : 'Sucesso';
        toolResultLines.push(`[Resultado da Ferramenta: ${toolName} - ${status}]`);
      }
    }
  }

  const parts: string[] = [];
  if (verbalText) {
    parts.push(verbalText);
  }
  if (toolCallLines.length > 0) {
    parts.push(...toolCallLines);
  }
  if (toolResultLines.length > 0) {
    parts.push(...toolResultLines);
  }

  const message = parts.length > 0 ? parts.join('\n') : '[Sem mensagem verbal]';

  return {
    role: resolvedRole,
    message,
    time_in_call_secs: time
  };
}

function asTranscriptEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.transcript)) {
      return record.transcript;
    }
    if (
      record.data &&
      typeof record.data === 'object' &&
      Array.isArray((record.data as Record<string, unknown>).transcript)
    ) {
      return (record.data as Record<string, unknown>).transcript as unknown[];
    }
    const historico = record.historico;
    if (Array.isArray(historico)) {
      return historico;
    }
  }
  return [];
}

function parseTranscriptPayload(raw: unknown): unknown[] {
  if (typeof raw === 'string') {
    try {
      return asTranscriptEntries(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return asTranscriptEntries(raw);
}

export function normalizeTranscricao(raw: unknown): TranscriptEntry[] {
  const items = parseTranscriptPayload(raw);
  const toolNamesById = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const calls = (item as Record<string, unknown>).tool_calls;
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (!call || typeof call !== 'object') continue;
        const callRecord = call as Record<string, unknown>;
        const callId =
          typeof callRecord.tool_call_id === 'string' ? callRecord.tool_call_id : null;
        const toolName = resolveToolName(callRecord);
        if (callId && toolName) {
          toolNamesById.set(callId, toolName);
        }
      }
    }
  }

  const entries: TranscriptEntry[] = [];
  for (const item of items) {
    const normalized = normalizeTranscriptEntry(item, toolNamesById);
    if (normalized) {
      entries.push(normalized);
    }
  }
  return entries;
}

export function transformToHistoricoTranscricao(raw: unknown): HistoricoTranscricao {
  const normalizedEntries = normalizeTranscricao(raw);
  const historico: HistoricoTurn[] = normalizedEntries.map((entry) => ({
    speaker: entry.role === 'agent' ? 'IA' : 'Cliente',
    message: entry.message,
    tempo_segundos: entry.time_in_call_secs,
    tempo_formatado: formatTime(entry.time_in_call_secs)
  }));
  return { historico };
}

export const transcriptEntrySchema = z
  .object({
    role: z.string().optional(),
    speaker: z.string().optional(),
    message: z.string().nullable().optional(),
    time_in_call_secs: z.union([z.number(), z.string()]).nullable().optional(),
    tempo_segundos: z.union([z.number(), z.string()]).nullable().optional(),
    tool_calls: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    tool_results: z.array(z.record(z.string(), z.unknown())).nullable().optional()
  })
  .passthrough()
  .transform((entry, ctx) => {
    const normalized = normalizeTranscriptEntry(entry);
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message: 'Entrada de transcrição inválida'
      });
      return z.NEVER;
    }
    return normalized;
  });

const toolExecutionsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    successful: z.number().int().nonnegative()
  })
  .refine(({ total, successful }) => successful <= total, {
    message: 'tools bem-sucedidas nao podem exceder o total'
  });

const ingestBaseSchema = z.object({
  conversation_id: z.string().trim().min(1),
  agent_id: z.string().trim().min(1),
  event_timestamp: z.number().int().nonnegative(),
  started_at: z.iso.datetime().nullable().optional(),
  transcript: z.array(transcriptEntrySchema),
  audio_reference: storageReference.nullable().optional(),
  contact_reason: optionalNullableText,
  transferred: z.boolean(),
  cost: optionalNullableNonnegativeNumber,
  tme_seconds: z.number().int().nonnegative().nullable().optional(),
  tool_executions: toolExecutionsSchema.optional()
});

export const ingestAtendimentoSchema = z.discriminatedUnion('status', [
  ingestBaseSchema.extend({
    status: z.literal('em_andamento'),
    completed_at: z.null().optional(),
    duration_seconds: optionalNullableNonnegativeNumber
  }),
  ingestBaseSchema.extend({
    status: z.literal('concluido'),
    completed_at: z.iso.datetime(),
    duration_seconds: z.number().int().nonnegative()
  })
]);

export const agenteVozSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  agentId: z.string()
});

export const atendimentoSummarySchema = z.object({
  id: z.uuid(),
  conversationId: z.string(),
  agenteVoz: agenteVozSchema,
  status: z.enum(['em_andamento', 'concluido']),
  iniciadoEm: z.iso.datetime().nullable(),
  concluidoEm: z.iso.datetime().nullable(),
  duracaoSegundos: z.number().int().nonnegative().nullable(),
  motivoContato: z.string().nullable(),
  houveTransferencia: z.boolean(),
  custo: z.number().nonnegative().nullable().optional()
});

export const atendimentoDetailSchema = atendimentoSummarySchema.extend({
  transcricao: z.array(transcriptEntrySchema),
  audioUrl: z.url().nullable()
});

export const atendimentoListSchema = z.object({
  items: z.array(atendimentoSummarySchema),
  total: z.number().int().min(0)
});

export const motivosAtendimentosSchema = z.array(z.string());

/** Dimensão do Detalhamento do Indicador (Dashboard → lista filtrada). */
export const detalhamentoIndicadorSchema = z.enum([
  'volume',
  'tma',
  'resolvidas',
  'sla',
  'nota_media_ia',
  'nota_media_curador',
  'promessas',
  'tempo_resolucao',
  'motivo',
  'criterio',
  'concordancia_nota',
  'concordancia_criterio'
]);

const isoDateSchema = z.iso.date();

export const atendimentosQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
    status: z.enum(['em_andamento', 'concluido']).optional(),
    inicio: isoDateSchema.optional(),
    fim: isoDateSchema.optional(),
    indicador: detalhamentoIndicadorSchema.optional(),
    motivo: z.string().trim().min(1).max(200).optional(),
    criterioId: z.uuid().optional()
  })
  .superRefine((query, ctx) => {
    if (query.indicador !== undefined && (!query.inicio || !query.fim)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Detalhamento exige periodo inicio/fim',
        path: ['inicio']
      });
      return;
    }
    if (!query.inicio && query.fim) {
      ctx.addIssue({
        code: 'custom',
        message: 'Periodo incompleto: informe inicio',
        path: ['inicio']
      });
      return;
    }
    const effectiveFim = query.fim ?? query.inicio;
    if (query.inicio && effectiveFim) {
      if (query.inicio > effectiveFim) {
        ctx.addIssue({
          code: 'custom',
          message: 'A data inicial deve ser anterior ou igual a data final',
          path: ['inicio']
        });
      }
      const maximumEnd = new Date(`${query.inicio}T00:00:00Z`);
      if (!Number.isNaN(maximumEnd.getTime())) {
        maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + 1);
        if (effectiveFim > maximumEnd.toISOString().slice(0, 10)) {
          ctx.addIssue({
            code: 'custom',
            message: 'O periodo nao pode exceder um ano',
            path: ['fim']
          });
        }
      }
    }
    if (query.indicador === 'motivo' && !query.motivo) {
      ctx.addIssue({
        code: 'custom',
        message: 'indicador=motivo exige o parametro motivo',
        path: ['motivo']
      });
    }
    if (
      (query.indicador === 'criterio' ||
        query.indicador === 'concordancia_criterio') &&
      !query.criterioId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${query.indicador} exige criterioId`,
        path: ['criterioId']
      });
    }
  })
  .transform((query) => {
    if (query.inicio && !query.fim) {
      return { ...query, fim: query.inicio };
    }
    return query;
  });

export type DetalhamentoIndicador = z.infer<typeof detalhamentoIndicadorSchema>;
export type AtendimentosQuery = z.infer<typeof atendimentosQuerySchema>;
export type IngestAtendimento = z.infer<typeof ingestAtendimentoSchema>;
export type AtendimentoSummary = z.infer<typeof atendimentoSummarySchema>;
export type AtendimentoList = z.infer<typeof atendimentoListSchema>;
export type AtendimentoDetail = z.infer<typeof atendimentoDetailSchema>;
export type MotivosAtendimentos = z.infer<typeof motivosAtendimentosSchema>;
