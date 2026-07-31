import { monitoramentoAuthMessageSchema } from '@hq-geap/contracts/monitoramento';
import type { RawData, WebSocket as WsWebSocket } from 'ws';

const authTimeoutMs = 5_000;

export function parseMonitoramentoAuthMessage(raw: unknown) {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const result = monitoramentoAuthMessageSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function waitForMonitoramentoAuthToken(
  socket: WsWebSocket,
  timeoutMs = authTimeoutMs
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    function onMessage(data: RawData) {
      const auth = parseMonitoramentoAuthMessage(String(data));
      cleanup();
      resolve(auth?.token ?? null);
    }

    function cleanup() {
      clearTimeout(timer);
      socket.off('message', onMessage);
    }

    socket.on('message', onMessage);
  });
}
