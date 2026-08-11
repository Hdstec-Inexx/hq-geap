import type { Page, WebSocketRoute } from '@playwright/test';

type StubOptions = {
  /** Transcript lines sent after auth/ready. Default: one stable agent line. */
  initialTranscripts?: Array<{ role: 'agent' | 'user'; message: string }>;
};

/**
 * Stubs the live Monitoramento WebSocket: answers auth with ready + optional
 * transcript seed. Counts handshakes so e2e can assert no reconnect.
 */
export async function stubMonitoramentoLiveWs(
  page: Page,
  options: StubOptions = {}
) {
  const initialTranscripts = options.initialTranscripts ?? [
    { role: 'agent' as const, message: 'Linha estável antes do foco' }
  ];
  let liveSockets = 0;
  let route: WebSocketRoute | undefined;

  await page.routeWebSocket(/\/monitoramento\/conversas\//, (ws) => {
    liveSockets += 1;
    route = ws;
    ws.onMessage((message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message));
      } catch {
        return;
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('type' in parsed) ||
        parsed.type !== 'auth'
      ) {
        return;
      }
      ws.send(JSON.stringify({ type: 'ready' }));
      for (const line of initialTranscripts) {
        ws.send(
          JSON.stringify({
            type: 'transcript',
            role: line.role,
            message: line.message
          })
        );
      }
    });
  });

  return {
    get liveSockets() {
      return liveSockets;
    },
    get route() {
      return route;
    },
    sendTranscript(role: 'agent' | 'user', message: string) {
      if (!route) {
        throw new Error('WebSocket do Monitoramento ao Vivo ainda não abriu');
      }
      route.send(
        JSON.stringify({
          type: 'transcript',
          role,
          message
        })
      );
    }
  };
}
