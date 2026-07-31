import WebSocket, { type WebSocket as WsWebSocket } from 'ws';
import {
  mapObservationEvent,
  maxUpstreamMessageBytes
} from './service.js';

const upstreamFailureMessage =
  'Falha no monitoramento da ElevenLabs. Verifique se ELEVENLABS_API_KEY é válida e se o Atendimento ainda está ativo.';

type ConnectFn = (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> }
) => WsWebSocket;

type ProxyOptions = {
  client: WsWebSocket;
  apiKey: string;
  monitorUrl: string;
  connect?: ConnectFn;
};

export function createMonitoramentoProxy({
  client,
  apiKey,
  monitorUrl,
  connect = (url, _protocols, options) => new WebSocket(url, options)
}: ProxyOptions) {
  let upstream: WsWebSocket;
  try {
    upstream = connect(monitorUrl, undefined, {
      headers: { 'xi-api-key': apiKey }
    });
  } catch {
    sendSafe(client, {
      type: 'error',
      message: 'Não foi possível conectar ao monitoramento da ElevenLabs'
    });
    client.close();
    return;
  }

  let settled = false;
  let finished = false;

  function fail(message: string) {
    if (finished) {
      return;
    }
    finished = true;
    sendSafe(client, { type: 'error', message });
    closeBoth();
  }

  function closeBoth() {
    if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) {
      client.close();
    }
    if (
      upstream.readyState === upstream.OPEN ||
      upstream.readyState === upstream.CONNECTING
    ) {
      upstream.close();
    }
  }

  upstream.on('open', () => {
    settled = true;
    sendSafe(client, { type: 'ready' });
  });

  upstream.on('message', (data) => {
    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data as ArrayBuffer).toString('utf8');
    if (raw.length > maxUpstreamMessageBytes) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const observation = mapObservationEvent(parsed);
    if (observation) {
      sendSafe(client, observation);
    }
  });

  upstream.on('close', () => {
    if (finished) {
      return;
    }
    finished = true;
    if (!settled) {
      sendSafe(client, { type: 'error', message: upstreamFailureMessage });
    } else {
      sendSafe(client, { type: 'ended' });
    }
    if (client.readyState === client.OPEN) {
      client.close();
    }
  });

  upstream.on('error', () => {
    fail(upstreamFailureMessage);
  });

  upstream.on('unexpected-response', (_request, response) => {
    fail(
      response.statusCode === 401 || response.statusCode === 403
        ? 'ELEVENLABS_API_KEY inválida ou sem permissão para Monitoramento ao Vivo.'
        : upstreamFailureMessage
    );
  });

  // Observation only: ignore any client payloads (never forward control commands).
  client.on('message', () => undefined);

  client.on('close', () => {
    finished = true;
    if (
      upstream.readyState === upstream.OPEN ||
      upstream.readyState === upstream.CONNECTING
    ) {
      upstream.close();
    }
  });

  client.on('error', () => {
    finished = true;
    if (
      upstream.readyState === upstream.OPEN ||
      upstream.readyState === upstream.CONNECTING
    ) {
      upstream.close();
    }
  });
}

function sendSafe(socket: WsWebSocket, payload: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
