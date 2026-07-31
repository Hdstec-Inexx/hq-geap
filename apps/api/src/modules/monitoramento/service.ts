import type { MonitoramentoEvent } from '@hq-geap/contracts/monitoramento';
import type { AppConfig } from '../../plugins/config.js';

export class MissingElevenLabsApiKeyError extends Error {
  constructor() {
    super('ELEVENLABS_API_KEY is required for Monitoramento ao Vivo');
    this.name = 'MissingElevenLabsApiKeyError';
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

type UpstreamEvent = {
  type?: string;
  user_transcription_event?: { user_transcript?: string };
  agent_response_event?: { agent_response?: string };
  agent_response_correction_event?: { corrected_agent_response?: string };
};

export function mapObservationEvent(raw: unknown): MonitoramentoEvent | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const event = raw as UpstreamEvent;
  switch (event.type) {
    case 'user_transcript': {
      const message = event.user_transcription_event?.user_transcript;
      return typeof message === 'string'
        ? { type: 'transcript', role: 'user', message }
        : null;
    }
    case 'agent_response': {
      const message = event.agent_response_event?.agent_response;
      return typeof message === 'string'
        ? { type: 'transcript', role: 'agent', message }
        : null;
    }
    case 'agent_response_correction': {
      const message =
        event.agent_response_correction_event?.corrected_agent_response;
      return typeof message === 'string'
        ? { type: 'correction', message }
        : null;
    }
    default:
      return null;
  }
}
