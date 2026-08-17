import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { parseAppConfig } from '../../apps/api/src/plugins/config.js';
import { parseMonitoramentoAuthMessage } from '../../apps/api/src/modules/monitoramento/auth.js';
import {
  ConversationNotOpenError,
  buildElevenLabsConversationUrl,
  buildElevenLabsConversationsUrl,
  buildElevenLabsMonitorUrl,
  excludeLocallyConcludedConversations,
  listLiveConversationsFromElevenLabs,
  liveDurationStaleGraceSecs,
  mapObservationEvent,
  maxObservationMessageChars,
  requireElevenLabsApiKey,
  requireOpenConversationAtElevenLabs
} from '../../apps/api/src/modules/monitoramento/service.js';
import { createMonitoramentoProxy } from '../../apps/api/src/modules/monitoramento/proxy.js';
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
  STORAGE_BUCKET: 'hq-geap',
  STORAGE_PUBLIC_URL: 'http://127.0.0.1:9000/hq-geap'
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
  const longMessage = 'x'.repeat(maxObservationMessageChars + 20);
  const clipped = mapObservationEvent({
    type: 'user_transcript',
    user_transcription_event: { user_transcript: longMessage }
  });
  assert.equal(clipped?.type, 'transcript');
  assert.equal(
    clipped && 'message' in clipped ? clipped.message.length : -1,
    maxObservationMessageChars
  );
  assert.equal(monitoramentoEventSchema.parse({
    type: 'transcript',
    role: 'user',
    message: 'ok'
  }).type, 'transcript');
});

const noCalendarDayFilter =
  /call_start|start_after|start_before|start_time|today|date|inicio|fim|after_unix|before_unix/i;

test('lista ao vivo usa o endpoint de conversas da ElevenLabs', () => {
  const openUrl = buildElevenLabsConversationsUrl(
    'https://api.elevenlabs.io',
    50,
    'open'
  );
  assert.match(openUrl, /^https:\/\/api\.elevenlabs\.io\/v1\/convai\/conversations\?/);
  assert.match(openUrl, /page_size=50/);
  assert.match(openUrl, /exclude_statuses=done/);
  assert.match(openUrl, /exclude_statuses=failed/);
  assert.match(openUrl, /exclude_statuses=processing/);
  assert.doesNotMatch(openUrl, /sk_|xi-api-key/i);
  assert.doesNotMatch(openUrl, noCalendarDayFilter);

  const allUrl = buildElevenLabsConversationsUrl(
    'https://api.elevenlabs.io',
    50,
    'all'
  );
  assert.match(allUrl, /page_size=50/);
  assert.doesNotMatch(allUrl, /exclude_statuses/);
  assert.doesNotMatch(allUrl, noCalendarDayFilter);
});

test('lista ao vivo filtra apenas conversas iniciadas ou em progresso', async () => {
  const nowSecs = 1_775_000_000;
  const catalog = [
    {
      conversation_id: 'conv_live',
      agent_id: 'agent_1',
      status: 'in-progress',
      start_time_unix_secs: nowSecs - 120,
      call_duration_secs: 120
    },
    {
      conversation_id: 'conv_initiated',
      agent_id: 'agent_1',
      status: 'initiated',
      start_time_unix_secs: nowSecs - 30,
      call_duration_secs: 0
    },
    {
      conversation_id: 'conv_done',
      agent_id: 'agent_1',
      status: 'done',
      start_time_unix_secs: nowSecs - 200
    },
    {
      conversation_id: 'conv_failed',
      agent_id: 'agent_1',
      status: 'failed',
      start_time_unix_secs: nowSecs - 300
    },
    {
      conversation_id: 'conv_processing',
      agent_id: 'agent_1',
      status: 'processing',
      start_time_unix_secs: nowSecs - 400
    }
  ];
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    const conversations = url.includes('exclude_statuses=')
      ? catalog.filter((item) =>
          item.status === 'in-progress' || item.status === 'initiated'
        )
      : catalog;
    return new Response(JSON.stringify({ conversations }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const live = await listLiveConversationsFromElevenLabs({
    apiBaseUrl: 'https://api.elevenlabs.io',
    apiKey: 'sk_test',
    fetchImpl,
    nowSecs
  });

  assert.equal(
    requestedUrls.filter((url) => url.includes('/conversations?')).length,
    2
  );
  assert.ok(requestedUrls.some((url) => /exclude_statuses=done/.test(url)));
  assert.ok(requestedUrls.some((url) => !/exclude_statuses=/.test(url)));
  assert.ok(
    requestedUrls.every((url) => !noCalendarDayFilter.test(url))
  );
  assert.deepEqual(
    live.map((item) => item.conversationId),
    ['conv_live', 'conv_initiated']
  );
  assert.deepEqual(
    live.map((item) => item.status),
    ['in-progress', 'initiated']
  );
  assert.equal(
    live[1]?.iniciadoEm,
    new Date((nowSecs - 30) * 1000).toISOString()
  );
});

test('lista ao vivo ignora conversas zombie ainda marcadas abertas na ElevenLabs', async () => {
  const nowSecs = 1_775_000_000;
  const catalog = [
    {
      conversation_id: 'conv_zombie_terminated',
      agent_id: 'agent_1',
      status: 'in-progress',
      start_time_unix_secs: nowSecs - 60,
      termination_reason: 'end_call',
      call_successful: 'success',
      call_duration_secs: 45
    },
    {
      conversation_id: 'conv_zombie_old',
      agent_id: 'agent_1',
      status: 'in-progress',
      // Mesmo padrão do bug: dias atrás, status preso em in-progress.
      start_time_unix_secs: nowSecs - 10 * 24 * 60 * 60,
      termination_reason: '',
      call_successful: 'unknown',
      call_duration_secs: 0
    },
    {
      conversation_id: 'conv_zombie_same_day',
      agent_id: 'agent_1',
      status: 'in-progress',
      // Encerrada há horas, duração congelada, sem termination_reason.
      start_time_unix_secs: nowSecs - 4 * 60 * 60,
      termination_reason: '',
      call_successful: 'unknown',
      call_duration_secs: 252
    },
    {
      conversation_id: 'conv_zombie_abandoned',
      agent_id: 'agent_1',
      status: 'initiated',
      start_time_unix_secs: nowSecs - (liveDurationStaleGraceSecs + 30),
      termination_reason: '',
      call_successful: 'unknown',
      call_duration_secs: 0
    },
    {
      conversation_id: 'conv_truly_live',
      agent_id: 'agent_1',
      status: 'in-progress',
      start_time_unix_secs: nowSecs - 120,
      termination_reason: '',
      call_successful: 'unknown',
      call_duration_secs: 120
    },
    {
      conversation_id: 'conv_initiated_fresh',
      agent_id: 'agent_1',
      status: 'initiated',
      start_time_unix_secs: nowSecs - 30,
      call_successful: 'unknown',
      call_duration_secs: 0
    }
  ];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const conversations = url.includes('exclude_statuses=')
      ? catalog.filter((item) =>
          item.status === 'in-progress' || item.status === 'initiated'
        )
      : catalog;
    return new Response(JSON.stringify({ conversations }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const live = await listLiveConversationsFromElevenLabs({
    apiBaseUrl: 'https://api.elevenlabs.io',
    apiKey: 'sk_test',
    fetchImpl,
    nowSecs
  });

  assert.deepEqual(
    live.map((item) => item.conversationId),
    ['conv_truly_live', 'conv_initiated_fresh']
  );
});

test('lista ao vivo descarta ID só no exclude_statuses e ausente na listagem geral', async () => {
  // HQ mostra conv_7101kz6c…; na listagem geral o mais próximo é outro ID (kz6g…).
  const nowSecs = 1_775_000_000;
  const ghost = {
    conversation_id: 'conv_7101kz6c7ktvf7as82v9feexbwxp',
    agent_id: 'agent_1',
    status: 'in-progress',
    start_time_unix_secs: nowSecs - 120,
    termination_reason: '',
    call_successful: 'unknown',
    call_duration_secs: 120
  };
  const lookalike = {
    conversation_id: 'conv_7101kz6g1fw2ensvr72crk4cn0hr',
    agent_id: 'agent_1',
    status: 'done',
    start_time_unix_secs: nowSecs - 200,
    call_duration_secs: 80,
    call_successful: 'success'
  };
  const liveItem = {
    conversation_id: 'conv_truly_live',
    agent_id: 'agent_1',
    status: 'in-progress',
    start_time_unix_secs: nowSecs - 90,
    termination_reason: '',
    call_successful: 'unknown',
    call_duration_secs: 90
  };
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    const conversations = url.includes('exclude_statuses=')
      ? [ghost, liveItem]
      : [lookalike, liveItem];
    return new Response(
      JSON.stringify({ conversations, has_more: false, next_cursor: null }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const live = await listLiveConversationsFromElevenLabs({
    apiBaseUrl: 'https://api.elevenlabs.io',
    apiKey: 'sk_test',
    fetchImpl,
    nowSecs
  });

  assert.deepEqual(
    live.map((item) => item.conversationId),
    ['conv_truly_live']
  );
  assert.ok(!live.some((item) => item.conversationId === ghost.conversation_id));
  assert.ok(
    !live.some((item) => item.conversationId === lookalike.conversation_id)
  );
  assert.equal(
    requestedUrls.filter((url) => url.includes('/conversations?')).length,
    2
  );
});

test('lista ao vivo pagina o catálogo geral até achar candidatas abertas', async () => {
  const nowSecs = 1_775_000_000;
  const liveItem = {
    conversation_id: 'conv_truly_live',
    agent_id: 'agent_1',
    status: 'in-progress',
    start_time_unix_secs: nowSecs - 90,
    termination_reason: '',
    call_successful: 'unknown',
    call_duration_secs: 90
  };
  const filler = {
    conversation_id: 'conv_done_filler',
    agent_id: 'agent_1',
    status: 'done',
    start_time_unix_secs: nowSecs - 50,
    call_duration_secs: 40,
    call_successful: 'success'
  };
  const catalogCursors: Array<string | null> = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.has('exclude_statuses')) {
      return new Response(
        JSON.stringify({
          conversations: [liveItem],
          has_more: false,
          next_cursor: null
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    const cursor = url.searchParams.get('cursor');
    catalogCursors.push(cursor);
    if (!cursor) {
      return new Response(
        JSON.stringify({
          conversations: [filler],
          has_more: true,
          next_cursor: 'cursor_page_2'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    assert.equal(cursor, 'cursor_page_2');
    return new Response(
      JSON.stringify({
        conversations: [liveItem],
        has_more: false,
        next_cursor: null
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const live = await listLiveConversationsFromElevenLabs({
    apiBaseUrl: 'https://api.elevenlabs.io',
    apiKey: 'sk_test',
    fetchImpl,
    nowSecs
  });

  assert.deepEqual(
    live.map((item) => item.conversationId),
    ['conv_truly_live']
  );
  assert.deepEqual(catalogCursors, [null, 'cursor_page_2']);
});

test('lista ao vivo remove Atendimentos já concluídos localmente', () => {
  assert.deepEqual(
    excludeLocallyConcludedConversations(
      [
        {
          conversationId: 'conv_open',
          agentId: 'agent_1',
          status: 'in-progress',
          iniciadoEm: null
        },
        {
          conversationId: 'conv_done_local',
          agentId: 'agent_1',
          status: 'in-progress',
          iniciadoEm: null
        }
      ],
      new Set(['conv_done_local'])
    ).map((item) => item.conversationId),
    ['conv_open']
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

test('observe exige conversa aberta na ElevenLabs antes do proxy', async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ status: 'done' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  await assert.rejects(
    () =>
      requireOpenConversationAtElevenLabs({
        apiBaseUrl: 'https://api.elevenlabs.io',
        apiKey: 'sk_test',
        conversationId: 'conv_closed',
        fetchImpl
      }),
    (error: unknown) =>
      error instanceof ConversationNotOpenError &&
      /não está mais aberta/i.test(error.message)
  );

  assert.equal(
    requestedUrls[0],
    buildElevenLabsConversationUrl('https://api.elevenlabs.io', 'conv_closed')
  );
  assert.doesNotMatch(requestedUrls[0]!, /sk_|xi-api-key/i);

  const nowSecs = Math.floor(Date.now() / 1000);
  const open = await requireOpenConversationAtElevenLabs({
    apiBaseUrl: 'https://api.elevenlabs.io',
    apiKey: 'sk_test',
    conversationId: 'conv_live',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: 'in-progress',
          metadata: {
            start_time_unix_secs: nowSecs - 90,
            call_duration_secs: 90
          }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
  });
  assert.equal(open, 'in-progress');
});

test('auth do monitoramento vem na primeira mensagem e nao na URL', () => {
  assert.deepEqual(
    parseMonitoramentoAuthMessage(
      JSON.stringify({ type: 'auth', token: 'jwt-session-token' })
    ),
    { type: 'auth', token: 'jwt-session-token' }
  );
  assert.equal(
    parseMonitoramentoAuthMessage(JSON.stringify({ command_type: 'end_call' })),
    null
  );
  assert.equal(
    parseMonitoramentoAuthMessage({ type: 'auth', token: '' }),
    null
  );
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
