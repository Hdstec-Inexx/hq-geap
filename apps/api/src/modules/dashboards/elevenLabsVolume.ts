import { civilPeriodUnixBounds } from './civilPeriodUnix.js';
import type { DashboardPeriod } from '@hq-geap/contracts/dashboards';

type ConversationSummary = {
  conversation_id?: string;
  agent_id?: string;
};

type ListResponse = {
  conversations?: ConversationSummary[];
  next_cursor?: string | null;
  has_more?: boolean;
};

/** Páginas máximas por requisição do Pulso (page_size 100). */
export const ELEVENLABS_VOLUME_MAX_PAGES = 40;
/** Orçamento total da listagem; estouro cai no volume HQ. */
export const ELEVENLABS_VOLUME_DEADLINE_MS = 8_000;

export function buildElevenLabsVolumeConversationsUrl(options: {
  apiBaseUrl: string;
  pageSize?: number;
  cursor?: string | null;
  agentId: string;
  callStartAfterUnix: number;
  callStartBeforeUnix: number;
}): string {
  const url = new URL('/v1/convai/conversations', options.apiBaseUrl);
  url.searchParams.set('page_size', String(options.pageSize ?? 100));
  url.searchParams.set('agent_id', options.agentId);
  url.searchParams.set(
    'call_start_after_unix',
    String(options.callStartAfterUnix)
  );
  url.searchParams.set(
    'call_start_before_unix',
    String(options.callStartBeforeUnix)
  );
  if (options.cursor) {
    url.searchParams.set('cursor', options.cursor);
  }
  return url.toString();
}

export async function countElevenLabsConversations(options: {
  apiBaseUrl: string;
  apiKey: string;
  agentIds: readonly string[];
  periodo: DashboardPeriod;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pageSize?: number;
  maxPages?: number;
  deadlineMs?: number;
  now?: () => number;
}): Promise<number> {
  const registered = [...new Set(options.agentIds)].filter(Boolean);
  if (registered.length === 0) {
    return 0;
  }

  const bounds = civilPeriodUnixBounds(options.periodo);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPages = options.maxPages ?? ELEVENLABS_VOLUME_MAX_PAGES;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? ELEVENLABS_VOLUME_DEADLINE_MS);
  let pagesUsed = 0;
  let total = 0;

  for (const agentId of registered) {
    let cursor: string | null = null;
    do {
      if (pagesUsed >= maxPages) {
        throw new Error('Listagem ElevenLabs excedeu o teto de paginas do Pulso');
      }
      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new Error('Listagem ElevenLabs excedeu o tempo do Pulso');
      }
      const url = buildElevenLabsVolumeConversationsUrl({
        apiBaseUrl: options.apiBaseUrl,
        pageSize: options.pageSize,
        cursor,
        agentId,
        callStartAfterUnix: bounds.callStartAfterUnix,
        callStartBeforeUnix: bounds.callStartBeforeUnix
      });
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { 'xi-api-key': options.apiKey },
          signal: AbortSignal.timeout(Math.min(timeoutMs, remaining))
        });
      } catch {
        throw new Error('Não foi possível listar Atendimentos na ElevenLabs');
      }
      pagesUsed += 1;
      if (!response.ok) {
        throw new Error('Falha ao listar Atendimentos na ElevenLabs');
      }
      let body: ListResponse;
      try {
        body = (await response.json()) as ListResponse;
      } catch {
        throw new Error('Resposta inválida ao listar Atendimentos na ElevenLabs');
      }
      for (const conversation of body.conversations ?? []) {
        if (
          typeof conversation.agent_id === 'string' &&
          conversation.agent_id === agentId
        ) {
          total += 1;
        }
      }
      const nextCursor =
        typeof body.next_cursor === 'string' && body.next_cursor.trim()
          ? body.next_cursor
          : null;
      if (body.has_more === true && nextCursor === null) {
        throw new Error('Listagem incompleta de Atendimentos na ElevenLabs');
      }
      cursor = body.has_more === true ? nextCursor : null;
    } while (cursor);
  }

  return total;
}

export async function resolveElevenLabsDashboardVolume(options: {
  apiKey?: string | null;
  apiBaseUrl: string;
  periodo: DashboardPeriod;
  listAgentIds: () => Promise<readonly string[]>;
  count?: typeof countElevenLabsConversations;
  onFailure?: (error: unknown) => void;
}): Promise<number | null> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return null;
  }
  try {
    const agentIds = await options.listAgentIds();
    const count = options.count ?? countElevenLabsConversations;
    return await count({
      apiBaseUrl: options.apiBaseUrl,
      apiKey,
      agentIds,
      periodo: options.periodo
    });
  } catch (error) {
    options.onFailure?.(error);
    return null;
  }
}
