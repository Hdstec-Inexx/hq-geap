import type { MonitoramentoEvent } from '@hq-geap/contracts/monitoramento';
import type { AppConfig } from '../../plugins/config.js';

export const maxUpstreamMessageBytes = 64_000;
export const maxObservationMessageChars = 4_096;

const liveStatuses = new Set(['initiated', 'in-progress']);
const terminalCallSuccessful = new Set(['success', 'failure']);

/** Limite de idade para status aberto: acima disso é zombie preso na ElevenLabs. */
export const maxLiveConversationAgeSecs = 24 * 60 * 60;

/**
 * Folga entre idade (wall clock) e `call_duration_secs`.
 * Se a duração congela e o relógio segue, a conversa já encerrou na prática.
 */
export const liveDurationStaleGraceSecs = 10 * 60;

export class MissingElevenLabsApiKeyError extends Error {
  constructor() {
    super('ELEVENLABS_API_KEY is required for Monitoramento ao Vivo');
    this.name = 'MissingElevenLabsApiKeyError';
  }
}

export class ElevenLabsListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElevenLabsListError';
  }
}

export class ConversationNotOpenError extends Error {
  constructor(message = 'Esta conversa não está mais aberta na ElevenLabs') {
    super(message);
    this.name = 'ConversationNotOpenError';
  }
}

export function requireElevenLabsApiKey(config: AppConfig): string {
  const key = config.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    throw new MissingElevenLabsApiKeyError();
  }
  return key;
}

export function buildElevenLabsMonitorUrl(
  apiBaseUrl: string,
  conversationId: string
): string {
  const base = new URL(apiBaseUrl);
  base.protocol = base.protocol === 'http:' ? 'ws:' : 'wss:';
  base.pathname = `/v1/convai/conversations/${encodeURIComponent(conversationId)}/monitor`;
  base.search = '';
  base.hash = '';
  return base.toString().replace(/\/$/, '');
}

/** Páginas máximas do catálogo geral ao resolver candidatas open∩all. */
export const maxLiveCatalogPages = 5;

export function buildElevenLabsConversationsUrl(
  apiBaseUrl: string,
  pageSize = 50,
  mode: 'open' | 'all' = 'open',
  cursor?: string | null
): string {
  const url = new URL('/v1/convai/conversations', apiBaseUrl);
  url.searchParams.set('page_size', String(pageSize));
  if (mode === 'open') {
    for (const status of ['done', 'failed', 'processing'] as const) {
      url.searchParams.append('exclude_statuses', status);
    }
  }
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  return url.toString();
}

export function buildElevenLabsConversationUrl(
  apiBaseUrl: string,
  conversationId: string
): string {
  const url = new URL(
    `/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    apiBaseUrl
  );
  return url.toString();
}

export function isLiveConversationStatus(
  status: string | null | undefined
): status is 'initiated' | 'in-progress' {
  return liveStatuses.has(status ?? '');
}

export function isActivelyOpenConversationSummary(
  conversation: {
    status?: string;
    start_time_unix_secs?: number;
    termination_reason?: string;
    call_successful?: string;
    call_duration_secs?: number;
  },
  nowSecs: number
): boolean {
  if (!isLiveConversationStatus(conversation.status)) {
    return false;
  }
  const reason = conversation.termination_reason?.trim();
  if (reason) {
    return false;
  }
  if (
    typeof conversation.call_successful === 'string' &&
    terminalCallSuccessful.has(conversation.call_successful)
  ) {
    return false;
  }
  if (typeof conversation.start_time_unix_secs !== 'number') {
    return false;
  }
  const ageSecs = nowSecs - conversation.start_time_unix_secs;
  if (ageSecs > maxLiveConversationAgeSecs) {
    return false;
  }
  const durationSecs =
    typeof conversation.call_duration_secs === 'number' &&
    Number.isFinite(conversation.call_duration_secs) &&
    conversation.call_duration_secs >= 0
      ? conversation.call_duration_secs
      : 0;
  // Duração congelada enquanto a idade avança → zombie (inclui mesmo dia).
  if (ageSecs > durationSecs + liveDurationStaleGraceSecs) {
    return false;
  }
  return true;
}

export function excludeLocallyConcludedConversations<
  T extends { conversationId: string }
>(live: T[], concludedConversationIds: ReadonlySet<string>): T[] {
  if (concludedConversationIds.size === 0) {
    return live;
  }
  return live.filter(
    (item) => !concludedConversationIds.has(item.conversationId)
  );
}

type UpstreamEvent = {
  type?: string;
  user_transcription_event?: { user_transcript?: string };
  agent_response_event?: { agent_response?: string };
  agent_response_correction_event?: { corrected_agent_response?: string };
};

function clipMessage(message: string): string {
  return message.length > maxObservationMessageChars
    ? message.slice(0, maxObservationMessageChars)
    : message;
}

export function mapObservationEvent(raw: unknown): MonitoramentoEvent | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const event = raw as UpstreamEvent;
  switch (event.type) {
    case 'user_transcript': {
      const message = event.user_transcription_event?.user_transcript;
      return typeof message === 'string'
        ? { type: 'transcript', role: 'user', message: clipMessage(message) }
        : null;
    }
    case 'agent_response': {
      const message = event.agent_response_event?.agent_response;
      return typeof message === 'string'
        ? { type: 'transcript', role: 'agent', message: clipMessage(message) }
        : null;
    }
    case 'agent_response_correction': {
      const message =
        event.agent_response_correction_event?.corrected_agent_response;
      return typeof message === 'string'
        ? { type: 'correction', message: clipMessage(message) }
        : null;
    }
    default:
      return null;
  }
}

type ElevenLabsConversation = {
  conversation_id?: string;
  agent_id?: string;
  status?: string;
  start_time_unix_secs?: number;
  termination_reason?: string;
  call_successful?: string;
  call_duration_secs?: number;
};

type ElevenLabsListResponse = {
  conversations?: ElevenLabsConversation[];
  next_cursor?: string | null;
  has_more?: boolean;
};

export type LiveConversation = {
  conversationId: string;
  agentId: string;
  status: 'initiated' | 'in-progress';
  iniciadoEm: string | null;
};

type ElevenLabsConversationDetail = {
  status?: string;
  agent_id?: string;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    termination_reason?: string;
  };
  termination_reason?: string;
  analysis?: { call_successful?: string } | null;
};

function openSummaryFromConversationDetail(body: ElevenLabsConversationDetail): {
  status?: string;
  start_time_unix_secs?: number;
  call_duration_secs?: number;
  termination_reason?: string;
  call_successful?: string;
} {
  return {
    status: body.status,
    start_time_unix_secs: body.metadata?.start_time_unix_secs,
    call_duration_secs: body.metadata?.call_duration_secs,
    termination_reason:
      body.termination_reason ?? body.metadata?.termination_reason,
    call_successful: body.analysis?.call_successful ?? undefined
  };
}

async function fetchConversationDetailFromElevenLabs(options: {
  apiBaseUrl: string;
  apiKey: string;
  conversationId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<ElevenLabsConversationDetail | null> {
  const url = buildElevenLabsConversationUrl(
    options.apiBaseUrl,
    options.conversationId
  );
  let response: Response;
  try {
    response = await options.fetchImpl(url, {
      headers: { 'xi-api-key': options.apiKey },
      signal: AbortSignal.timeout(options.timeoutMs)
    });
  } catch {
    throw new ElevenLabsListError(
      'Não foi possível verificar o status da conversa na ElevenLabs'
    );
  }

  if (response.status === 404) {
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ElevenLabsListError(
      'ELEVENLABS_API_KEY inválida ou sem permissão para consultar conversas'
    );
  }
  if (!response.ok) {
    throw new ElevenLabsListError(
      'Falha ao consultar o status da conversa na ElevenLabs'
    );
  }

  try {
    return (await response.json()) as ElevenLabsConversationDetail;
  } catch {
    throw new ElevenLabsListError(
      'Resposta inválida ao consultar conversa na ElevenLabs'
    );
  }
}

export async function requireOpenConversationAtElevenLabs(options: {
  apiBaseUrl: string;
  apiKey: string;
  conversationId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<'initiated' | 'in-progress'> {
  const body = await fetchConversationDetailFromElevenLabs({
    apiBaseUrl: options.apiBaseUrl,
    apiKey: options.apiKey,
    conversationId: options.conversationId,
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? 10_000
  });
  if (!body) {
    throw new ConversationNotOpenError(
      'Conversa não encontrada na ElevenLabs — não é possível observar'
    );
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  if (
    !isActivelyOpenConversationSummary(
      openSummaryFromConversationDetail(body),
      nowSecs
    ) ||
    !isLiveConversationStatus(body.status)
  ) {
    throw new ConversationNotOpenError(
      'Esta conversa não está mais aberta na ElevenLabs'
    );
  }
  return body.status;
}

async function fetchConversationsPageFromElevenLabs(options: {
  apiBaseUrl: string;
  apiKey: string;
  pageSize: number;
  mode: 'open' | 'all';
  cursor?: string | null;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<{
  conversations: ElevenLabsConversation[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const url = buildElevenLabsConversationsUrl(
    options.apiBaseUrl,
    options.pageSize,
    options.mode,
    options.cursor
  );
  let response: Response;
  try {
    response = await options.fetchImpl(url, {
      headers: { 'xi-api-key': options.apiKey },
      signal: AbortSignal.timeout(options.timeoutMs)
    });
  } catch {
    throw new ElevenLabsListError(
      'Não foi possível listar conversas ao vivo na ElevenLabs'
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ElevenLabsListError(
      'ELEVENLABS_API_KEY inválida ou sem permissão para listar conversas'
    );
  }
  if (!response.ok) {
    throw new ElevenLabsListError(
      'Falha ao listar conversas ao vivo na ElevenLabs'
    );
  }

  let body: ElevenLabsListResponse;
  try {
    body = (await response.json()) as ElevenLabsListResponse;
  } catch {
    throw new ElevenLabsListError(
      'Resposta inválida ao listar conversas na ElevenLabs'
    );
  }
  const nextCursor =
    typeof body.next_cursor === 'string' && body.next_cursor.trim()
      ? body.next_cursor
      : null;
  return {
    conversations: body.conversations ?? [],
    nextCursor,
    hasMore: body.has_more === true && nextCursor !== null
  };
}

function catalogMissingIds(
  needed: ReadonlySet<string>,
  catalogIds: ReadonlySet<string>
): boolean {
  for (const id of needed) {
    if (!catalogIds.has(id)) {
      return true;
    }
  }
  return false;
}

export async function listLiveConversationsFromElevenLabs(options: {
  apiBaseUrl: string;
  apiKey: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  nowSecs?: number;
}): Promise<LiveConversation[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowSecs = options.nowSecs ?? Math.floor(Date.now() / 1000);
  const pageSize = options.pageSize ?? 50;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const openPage = await fetchConversationsPageFromElevenLabs({
    apiBaseUrl: options.apiBaseUrl,
    apiKey: options.apiKey,
    pageSize,
    mode: 'open',
    fetchImpl,
    timeoutMs
  });

  const candidates: LiveConversation[] = [];
  for (const conversation of openPage.conversations) {
    const conversationId = conversation.conversation_id;
    const agentId = conversation.agent_id;
    const startSecs = conversation.start_time_unix_secs;
    if (
      typeof conversationId !== 'string' ||
      typeof agentId !== 'string' ||
      typeof startSecs !== 'number' ||
      !isActivelyOpenConversationSummary(conversation, nowSecs) ||
      !isLiveConversationStatus(conversation.status)
    ) {
      continue;
    }
    candidates.push({
      conversationId,
      agentId,
      status: conversation.status,
      iniciadoEm: new Date(startSecs * 1000).toISOString()
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  // exclude_statuses pode devolver IDs que o monitor ainda aceita
  // (history_complete) mas que não estão na listagem geral — inclusive
  // lookalikes de prefixo. Página o catálogo até achar as candidatas ou acabar.
  const needed = new Set(candidates.map((item) => item.conversationId));
  const catalogIds = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < maxLiveCatalogPages; page += 1) {
    if (page > 0 && !catalogMissingIds(needed, catalogIds)) {
      break;
    }
    const catalogPage = await fetchConversationsPageFromElevenLabs({
      apiBaseUrl: options.apiBaseUrl,
      apiKey: options.apiKey,
      pageSize,
      mode: 'all',
      cursor,
      fetchImpl,
      timeoutMs
    });
    for (const item of catalogPage.conversations) {
      if (typeof item.conversation_id === 'string') {
        catalogIds.add(item.conversation_id);
      }
    }
    if (!catalogMissingIds(needed, catalogIds) || !catalogPage.hasMore) {
      break;
    }
    cursor = catalogPage.nextCursor;
  }

  return candidates.filter((item) => catalogIds.has(item.conversationId));
}
