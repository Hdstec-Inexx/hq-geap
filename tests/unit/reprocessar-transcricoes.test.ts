import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchElevenLabsConversation,
  findInconsistentConversationIdsQuery,
  reprocessConversation,
  runPass
} from '../../scripts/reprocessar-transcricoes.js';

test('fetchElevenLabsConversation busca dados da conversa na API ElevenLabs com autenticacao', async () => {
  let requestedUrl = '';
  let requestedHeaders: Record<string, string> = {};

  const mockFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-test-123',
        status: 'done',
        transcript: [
          { role: 'agent', message: 'Olá', time_in_call_secs: 0 }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const result = await fetchElevenLabsConversation('conv-test-123', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  });

  assert.equal(requestedUrl, 'https://api.elevenlabs.io/v1/convai/conversations/conv-test-123');
  assert.equal(requestedHeaders['xi-api-key'], 'test-api-key');
  assert.equal(result?.conversation_id, 'conv-test-123');
});

test('fetchElevenLabsConversation retorna null quando a API responde 404 ou erro', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
  };

  const result = await fetchElevenLabsConversation('conv-404', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  });

  assert.equal(result, null);
});

test('findInconsistentConversationIdsQuery gera SQL que filtra atendimentos concluidos com transcricoes invalidas ou nulas', () => {
  const query = findInconsistentConversationIdsQuery();
  assert.match(query, /status = 'concluido'/i);
  assert.match(query, /transcricao is null/i);
  assert.match(query, /historico/i);
  assert.match(query, /elevenlabs_conversation_id/i);
  assert.match(query, /duracao_segundos/i);
  assert.match(query, /tempo_segundos/i);
});

test('reprocessConversation transforma transcript e atualiza banco de dados de forma transacional', async () => {
  const executedQueries: Array<{ text: string; values?: unknown[] }> = [];

  const mockDb = {
    query: async (text: string, values?: unknown[]) => {
      executedQueries.push({ text, values });
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-abc',
        status: 'done',
        transcript: [
          { role: 'agent', message: 'Olá Lívia', time_in_call_secs: 0 },
          { role: 'user', message: 'Segunda via', time_in_call_secs: 4 },
          {
            role: 'agent',
            message: null,
            time_in_call_secs: 8,
            tool_calls: [
              { tool_name: 'consultar_boleto', tool_call_id: 'call-1', tool_has_been_called: true }
            ]
          },
          {
            role: 'agent',
            message: null,
            time_in_call_secs: 10,
            tool_results: [
              { tool_call_id: 'call-1', is_error: false }
            ]
          }
        ]
      }),
      { status: 200 }
    );
  };

  const outcome = await reprocessConversation(mockDb as any, 'conv-abc', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'key',
    fetchFn: mockFetch
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.conversationId, 'conv-abc');

  assert.ok(executedQueries.some((q) => q.text === 'begin'));
  assert.ok(executedQueries.some((q) => q.text === 'commit'));

  const updateQuery = executedQueries.find((q) => q.text.includes('update atendimentos'));
  assert.ok(updateQuery);
  assert.equal(updateQuery.values?.[1], 'conv-abc');

  const savedTranscricao = JSON.parse(updateQuery.values?.[0] as string);
  assert.deepEqual(savedTranscricao, {
    historico: [
      {
        speaker: 'IA',
        message: 'Olá Lívia',
        tempo_segundos: 0,
        tempo_formatado: '00:00'
      },
      {
        speaker: 'Cliente',
        message: 'Segunda via',
        tempo_segundos: 4,
        tempo_formatado: '00:04'
      },
      {
        speaker: 'IA',
        message: '[Chamada de Ferramenta: consultar_boleto]',
        tempo_segundos: 8,
        tempo_formatado: '00:08'
      },
      {
        speaker: 'IA',
        message: '[Resultado da Ferramenta: consultar_boleto - Sucesso]',
        tempo_segundos: 10,
        tempo_formatado: '00:10'
      }
    ]
  });
});

test('runPass suporta lista pontual de conversation IDs e executa em lote com metricas claras', async () => {
  const executedUpdates: string[] = [];

  const mockDb = {
    connect: async () => {},
    end: async () => {},
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('update atendimentos')) {
        executedUpdates.push(values?.[1] as string);
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('conv-fail')) {
      return new Response(JSON.stringify({ detail: 'Error' }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-ok',
        status: 'done',
        transcript: [{ role: 'agent', message: 'Oi', time_in_call_secs: 0 }]
      }),
      { status: 200 }
    );
  };

  const result = await runPass({
    specificIds: ['conv-ok-1', 'conv-fail', 'conv-ok-2'],
    dbClient: mockDb as any,
    fetchFn: mockFetch,
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key'
  });

  assert.equal(result.processed, 3);
  assert.equal(result.success, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(executedUpdates, ['conv-ok-1', 'conv-ok-2']);
});

test('reprocessConversation falha e faz rollback se o atendimento nao estiver concluido ou nao existir', async () => {
  const executedQueries: Array<{ text: string }> = [];

  const mockDb = {
    query: async (text: string) => {
      executedQueries.push({ text });
      if (text.includes('update atendimentos')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-not-concluido',
        status: 'done',
        transcript: [{ role: 'agent', message: 'Olá', time_in_call_secs: 0 }]
      }),
      { status: 200 }
    );
  };

  const outcome = await reprocessConversation(mockDb as any, 'conv-not-concluido', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'key',
    fetchFn: mockFetch
  });

  assert.equal(outcome.success, false);
  assert.match(outcome.error ?? '', /não encontrado/i);
  assert.ok(executedQueries.some((q) => q.text === 'rollback'));
});

test('runPass executa selecao em lote parametrizada quando nao ha IDs especificos', async () => {
  const executedBatchQueries: Array<{ text: string; values?: unknown[] }> = [];

  const mockDb = {
    connect: async () => {},
    end: async () => {},
    query: async (text: string, values?: unknown[]) => {
      executedBatchQueries.push({ text, values });
      if (text.includes('select elevenlabs_conversation_id')) {
        return { rowCount: 1, rows: [{ conversationId: 'conv-batch-1' }] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-batch-1',
        status: 'done',
        transcript: [{ role: 'agent', message: 'Oi', time_in_call_secs: 0 }]
      }),
      { status: 200 }
    );
  };

  const result = await runPass({
    limit: 100,
    dbClient: mockDb as any,
    fetchFn: mockFetch,
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key'
  });

  assert.equal(result.processed, 1);
  assert.equal(result.success, 1);

  const selectQuery = executedBatchQueries.find((q) => q.text.includes('select elevenlabs_conversation_id'));
  assert.ok(selectQuery);
  assert.deepEqual(selectQuery.values, [100]);
  assert.match(selectQuery.text, /limit \$1/i);
});


