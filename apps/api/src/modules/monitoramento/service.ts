import type { MonitoramentoEvent } from '@hq-geap/contracts/monitoramento';
import type { AppConfig } from '../../plugins/config.js';

export const maxUpstreamMessageBytes = 64_000;
export const maxObservationMessageChars = 4_096;

const liveStatuses = new Set(['initiated', 'in-progress']);

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

export function buildElevenLabsConversationsUrl(
  apiBaseUrl: string,
  pageSize = 50
): string {
  const url = new URL('/v1/convai/conversations', apiBaseUrl);
  url.searchParams.set('page_size', String(pageSize));
  for (const status of ['done', 'failed', 'processing'] as const) {
    url.searchParams.append('exclude_statuses', status);
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
};

type ElevenLabsListResponse = {
  conversations?: ElevenLabsConversation[];
};

export type LiveConversation = {
  conversationId: string;
  agentId: string;
  status: 'initiated' | 'in-progress';
  iniciadoEm: string | null;
};

export async function requireOpenConversationAtElevenLabs(options: {
  apiBaseUrl: string;
  apiKey: string;
  conversationId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<'initiated' | 'in-progress'> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildElevenLabsConversationUrl(
    options.apiBaseUrl,
    options.conversationId
  );
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'xi-api-key': options.apiKey },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
    });
  } catch {
    throw new ElevenLabsListError(
      'Não foi possível verificar o status da conversa na ElevenLabs'
    );
  }

  if (response.status === 404) {
    throw new ConversationNotOpenError(
      'Conversa não encontrada na ElevenLabs — não é possível observar'
    );
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

  let body: { status?: string };
  try {
    body = (await response.json()) as { status?: string };
  } catch {
    throw new ElevenLabsListError(
      'Resposta inválida ao consultar conversa na ElevenLabs'
    );
  }

  if (!isLiveConversationStatus(body.status)) {
    throw new ConversationNotOpenError(
      'Esta conversa não está mais aberta na ElevenLabs'
    );
  }
  return body.status;
}

export async function listLiveConversationsFromElevenLabs(options: {
  apiBaseUrl: string;
  apiKey: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LiveConversation[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildElevenLabsConversationsUrl(
    options.apiBaseUrl,
    options.pageSize ?? 50
  );
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'xi-api-key': options.apiKey },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
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

  const live: LiveConversation[] = [];
  for (const conversation of body.conversations ?? []) {
    if (
      typeof conversation.conversation_id !== 'string' ||
      typeof conversation.agent_id !== 'string' ||
      !liveStatuses.has(conversation.status ?? '')
    ) {
      continue;
    }
    const status = conversation.status as 'initiated' | 'in-progress';
    const started =
      typeof conversation.start_time_unix_secs === 'number'
        ? new Date(conversation.start_time_unix_secs * 1000).toISOString()
        : null;
    live.push({
      conversationId: conversation.conversation_id,
      agentId: conversation.agent_id,
      status,
      iniciadoEm: started
    });
  }
  return live;
}
