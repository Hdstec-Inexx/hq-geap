import WebSocket, { type WebSocket as WsWebSocket } from 'ws';
import { mapObservationEvent } from './service.js';

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

  upstream.on('open', () => {
    settled = true;
    sendSafe(client, { type: 'ready' });
  });

  upstream.on('message', (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      return;
    }
    const observation = mapObservationEvent(parsed);
    if (observation) {
      sendSafe(client, observation);
    }
  });

  upstream.on('close', () => {
    if (!settled) {
      sendSafe(client, {
        type: 'error',
        message:
          'Falha no monitoramento da ElevenLabs. Verifique se ELEVENLABS_API_KEY é válida e se o Atendimento ainda está ativo.'
      });
    } else {
      sendSafe(client, { type: 'ended' });
    }
    if (client.readyState === client.OPEN) {
      client.close();
    }
  });

  upstream.on('error', () => {
    sendSafe(client, {
      type: 'error',
      message:
        'Falha no monitoramento da ElevenLabs. Verifique se ELEVENLABS_API_KEY é válida e se o Atendimento ainda está ativo.'
    });
    if (client.readyState === client.OPEN) {
      client.close();
    }
  });

  upstream.on('unexpected-response', (_request, response) => {
    sendSafe(client, {
      type: 'error',
      message:
        response.statusCode === 401 || response.statusCode === 403
          ? 'ELEVENLABS_API_KEY inválida ou sem permissão para Monitoramento ao Vivo.'
          : 'Falha no monitoramento da ElevenLabs. Verifique se ELEVENLABS_API_KEY é válida e se o Atendimento ainda está ativo.'
    });
    if (client.readyState === client.OPEN) {
      client.close();
    }
  });

  // Observation only: ignore any client payloads (never forward control commands).
  client.on('message', () => undefined);

  client.on('close', () => {
    if (
      upstream.readyState === upstream.OPEN ||
      upstream.readyState === upstream.CONNECTING
    ) {
      upstream.close();
    }
  });

  client.on('error', () => {
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
