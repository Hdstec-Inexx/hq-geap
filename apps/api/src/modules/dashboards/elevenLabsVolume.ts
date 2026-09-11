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

export function buildElevenLabsVolumeConversationsUrl(options: {
  apiBaseUrl: string;
  pageSize?: number;
  cursor?: string | null;
  callStartAfterUnix: number;
  callStartBeforeUnix: number;
}): string {
  const url = new URL('/v1/convai/conversations', options.apiBaseUrl);
  url.searchParams.set('page_size', String(options.pageSize ?? 100));
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
}): Promise<number> {
  const registered = new Set(options.agentIds);
  if (registered.size === 0) {
    return 0;
  }

  const bounds = civilPeriodUnixBounds(options.periodo);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let cursor: string | null = null;
  let total = 0;

  do {
    const url = buildElevenLabsVolumeConversationsUrl({
      apiBaseUrl: options.apiBaseUrl,
      pageSize: options.pageSize,
      cursor,
      callStartAfterUnix: bounds.callStartAfterUnix,
      callStartBeforeUnix: bounds.callStartBeforeUnix
    });
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { 'xi-api-key': options.apiKey },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new Error('Não foi possível listar Atendimentos na ElevenLabs');
    }
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
        registered.has(conversation.agent_id)
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

  return total;
}
