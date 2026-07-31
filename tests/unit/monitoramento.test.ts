import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { parseAppConfig } from '../../apps/api/src/plugins/config.js';
import {
  buildElevenLabsMonitorUrl,
  mapObservationEvent,
  requireElevenLabsApiKey
} from '../../apps/api/src/modules/monitoramento/service.js';
import { createMonitoramentoProxy } from '../../apps/api/src/modules/monitoramento/proxy.js';
import { atendimentosQuerySchema } from '../../packages/contracts/src/atendimentos.js';
import { monitoramentoEventSchema } from '../../packages/contracts/src/monitoramento.js';

const baseEnv = {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3000',
  DATABASE_URL: 'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap',
  CORS_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'development-only-secret-change-me',
  JWT_EXPIRES_IN_SECONDS: '28800',
  INGESTION_API_KEY: 'development-ingestion-key-change-me',
  STORAGE_PROVIDER: 'public',
  STORAGE_BUCKET: 'hq-geap-audio',
  STORAGE_PUBLIC_URL: 'http://127.0.0.1:9000/hq-geap-audio'
} as const;

test('ELEVENLABS_API_KEY e documentada e obrigatoria em producao', () => {
  assert.throws(
    () => parseAppConfig({ ...baseEnv, NODE_ENV: 'production' }),
    /ELEVENLABS_API_KEY/
  );

  const config = parseAppConfig({
    ...baseEnv,
    NODE_ENV: 'production',
    JWT_SECRET: 'production-secret-with-at-least-32-chars',
    INGESTION_API_KEY: 'production-ingestion-key-with-32chars',
    STORAGE_PROVIDER: 'minio',
    STORAGE_ENDPOINT: 'https://storage.example.com',
    STORAGE_ACCESS_KEY: 'access',
    STORAGE_SECRET_KEY: 'secret',
    ELEVENLABS_API_KEY: 'sk_test_monitoramento'
  });

  assert.equal(config.ELEVENLABS_API_KEY, 'sk_test_monitoramento');
});

test('sem chave o monitoramento falha de forma explicita', () => {
  const config = parseAppConfig(baseEnv);
  assert.equal(config.ELEVENLABS_API_KEY, undefined);
  assert.throws(() => requireElevenLabsApiKey(config), /ELEVENLABS_API_KEY/);
});

test('mapeia apenas eventos de texto/metadados para o contrato de observacao', () => {
  assert.deepEqual(
    mapObservationEvent({
      type: 'user_transcript',
      user_transcription_event: { user_transcript: 'preciso de boleto' }
    }),
    { type: 'transcript', role: 'user', message: 'preciso de boleto' }
  );
  assert.deepEqual(
    mapObservationEvent({
      type: 'agent_response',
      agent_response_event: { agent_response: 'Claro, posso ajudar.' }
    }),
    { type: 'transcript', role: 'agent', message: 'Claro, posso ajudar.' }
  );
  assert.deepEqual(
    mapObservationEvent({
      type: 'agent_response_correction',
      agent_response_correction_event: {
        original_agent_response: 'texto longo',
        corrected_agent_response: 'texto'
      }
    }),
    { type: 'correction', message: 'texto' }
  );
  assert.equal(
    mapObservationEvent({
      type: 'audio',
      audio_event: { audio_base_64: 'AAAA', event_id: 1 }
    }),
    null
  );
  assert.equal(monitoramentoEventSchema.parse({
    type: 'transcript',
    role: 'user',
    message: 'ok'
  }).type, 'transcript');
});

test('lista de monitoramento filtra Atendimentos em andamento', () => {
  assert.deepEqual(
    atendimentosQuerySchema.parse({ status: 'em_andamento' }),
    { limit: 50, offset: 0, status: 'em_andamento' }
  );
});

test('URL de monitoramento usa conversation_id sem expor a chave', () => {
  const url = buildElevenLabsMonitorUrl(
    'https://api.elevenlabs.io',
    'conv_abc123'
  );
  assert.equal(
    url,
    'wss://api.elevenlabs.io/v1/convai/conversations/conv_abc123/monitor'
  );
  assert.doesNotMatch(url, /sk_|xi-api-key/i);
});

test('proxy retransmite observacao e nunca envia comando de controle', async () => {
  const upstreamEvents: string[] = [];
  const clientMessages: unknown[] = [];

  await new Promise<void>((resolve, reject) => {
    const httpServer = createServer();
    const upstream = new WebSocketServer({ server: httpServer, path: '/monitor' });

    upstream.on('connection', (socket, request) => {
      assert.equal(request.headers['xi-api-key'], 'sk_test_key');
      socket.send(
        JSON.stringify({
          type: 'user_transcript',
          user_transcription_event: { user_transcript: 'ola' }
        })
      );
      socket.send(
        JSON.stringify({
          type: 'audio',
          audio_event: { audio_base_64: 'AUDIO', event_id: 1 }
        })
      );
      socket.send(
        JSON.stringify({
          type: 'agent_response',
          agent_response_event: { agent_response: 'oi' }
        })
      );
      socket.on('message', (data) => {
        upstreamEvents.push(String(data));
      });
    });

    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('expected tcp address'));
        return;
      }

      const clientServer = createServer();
      const clientWss = new WebSocketServer({ server: clientServer });
      clientWss.on('connection', (client) => {
        createMonitoramentoProxy({
          client,
          apiKey: 'sk_test_key',
          monitorUrl: `ws://127.0.0.1:${address.port}/monitor`,
          connect: (url, protocols, options) =>
            new WebSocket(url, protocols, options)
        });
      });

      clientServer.listen(0, '127.0.0.1', () => {
        const clientAddress = clientServer.address();
        if (!clientAddress || typeof clientAddress === 'string') {
          reject(new Error('expected client tcp address'));
          return;
        }

        const client = new WebSocket(`ws://127.0.0.1:${clientAddress.port}`);
        client.on('message', (data) => {
          clientMessages.push(JSON.parse(String(data)));
          if (clientMessages.length === 3) {
            client.send(JSON.stringify({ command_type: 'end_call' }));
            setTimeout(() => {
              client.close();
              clientServer.close();
              httpServer.close();
              resolve();
            }, 50);
          }
        });
        client.on('error', reject);
      });
    });
  });

  assert.deepEqual(clientMessages, [
    { type: 'ready' },
    { type: 'transcript', role: 'user', message: 'ola' },
    { type: 'transcript', role: 'agent', message: 'oi' }
  ]);
  assert.deepEqual(upstreamEvents, []);
});
