import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTranscricao,
  isTranscricaoInconsistente
} from '@hq-geap/contracts/atendimentos';
import {
  buildInconsistentTranscriptionSqlPredicate,
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

test('buildInconsistentTranscriptionSqlPredicate gera predicado SQL compativel com array legado e objeto historico', () => {
  const defaultPredicate = buildInconsistentTranscriptionSqlPredicate();
  assert.match(defaultPredicate, /transcricao is null/i);
  assert.match(defaultPredicate, /jsonb_typeof\(transcricao\) not in \('array', 'object'\)/i);
  assert.match(defaultPredicate, /jsonb_array_length/i);
  assert.match(defaultPredicate, /jsonb_typeof\(transcricao\) = 'array'/i);
  assert.match(defaultPredicate, /jsonb_typeof\(transcricao->'historico'\) = 'array'/i);
  assert.match(defaultPredicate, /jsonb_typeof\(transcricao->'transcript'\) = 'array'/i);
  assert.match(defaultPredicate, /time_in_call_secs/i);
  assert.match(defaultPredicate, /tempo_segundos/i);
  assert.match(defaultPredicate, /> 1/i);

  const aliasedPredicate = buildInconsistentTranscriptionSqlPredicate('a.transcricao');
  assert.match(aliasedPredicate, /a\.transcricao is null/i);
  assert.match(aliasedPredicate, /jsonb_typeof\(a\.transcricao\) not in \('array', 'object'\)/i);
  assert.match(aliasedPredicate, /jsonb_typeof\(a\.transcricao\) = 'array'/i);
  assert.match(aliasedPredicate, /jsonb_typeof\(a\.transcricao->'historico'\) = 'array'/i);
});

test('findInconsistentConversationIdsQuery gera SQL que filtra atendimentos concluidos com transcricoes invalidas, nulas ou tempos zerados em multiplos turnos', () => {
  const query = findInconsistentConversationIdsQuery();
  assert.match(query, /status = 'concluido'/i);
  assert.match(query, /transcricao is null/i);
  assert.match(query, /jsonb_typeof\(transcricao\) not in \('array', 'object'\)/i);
  assert.match(query, /jsonb_typeof\(transcricao\) = 'array'/i);
  assert.match(query, /jsonb_typeof\(transcricao->'historico'\) = 'array'/i);
  assert.match(query, /elevenlabs_conversation_id/i);
  assert.match(query, /time_in_call_secs/i);
  assert.match(query, /tempo_segundos/i);
  assert.match(query, /jsonb_array_length/i);
  assert.match(query, /order by concluido_em desc nulls last/i);
  assert.match(query, /limit \$1/i);

  const aliasedQuery = findInconsistentConversationIdsQuery({ tableAlias: 'a' });
  assert.match(aliasedQuery, /from atendimentos a/i);
  assert.match(aliasedQuery, /a\.elevenlabs_conversation_id/i);
  assert.match(aliasedQuery, /a\.status = 'concluido'/i);
  assert.match(aliasedQuery, /a\.transcricao is null/i);

  const forceQuery = findInconsistentConversationIdsQuery({ force: true });
  assert.match(forceQuery, /status = 'concluido'/i);
  assert.doesNotMatch(forceQuery, /transcricao is null/i);
  assert.match(forceQuery, /limit \$1/i);

  // Validação de segurança de identificadores SQL contra injeção
  assert.throws(
    () => buildInconsistentTranscriptionSqlPredicate('transcricao; drop table atendimentos; --'),
    /Identificador SQL inválido/
  );
  assert.throws(
    () => findInconsistentConversationIdsQuery({ tableAlias: 'a; drop table atendimentos; --' }),
    /Identificador SQL inválido/
  );
});

test('isTranscricaoInconsistente identifica atendimentos concluidos com transcricao nula ou vazia', () => {
  assert.equal(isTranscricaoInconsistente(null), true);
  assert.equal(isTranscricaoInconsistente(undefined), true);
  assert.equal(isTranscricaoInconsistente(''), true);
  assert.equal(isTranscricaoInconsistente('   '), true);
  assert.equal(isTranscricaoInconsistente('invalid json'), true);
  assert.equal(isTranscricaoInconsistente([]), true);
  assert.equal(isTranscricaoInconsistente({}), true);
  assert.equal(isTranscricaoInconsistente({ historico: [] }), true);
  assert.equal(isTranscricaoInconsistente({ transcript: [] }), true);
  assert.equal(isTranscricaoInconsistente({ data: { transcript: [] } }), true);
  assert.equal(isTranscricaoInconsistente(JSON.stringify([])), true);
  assert.equal(isTranscricaoInconsistente(JSON.stringify({ historico: [] })), true);
  assert.equal(isTranscricaoInconsistente(42), true);
  assert.equal(isTranscricaoInconsistente(true), true);
});

test('isTranscricaoInconsistente identifica atendimentos com mais de um turno com timestamp zerado ou nulo em array e objeto historico', () => {
  // Formato array legado com múltiplos turnos zerados
  const arrayZerados = [
    { role: 'agent', message: 'Olá Lívia', time_in_call_secs: 0 },
    { role: 'user', message: 'Segunda via', time_in_call_secs: 0 },
    { role: 'agent', message: 'Vou consultar', time_in_call_secs: 0 }
  ];
  assert.equal(isTranscricaoInconsistente(arrayZerados), true);
  assert.equal(isTranscricaoInconsistente(JSON.stringify(arrayZerados)), true);

  // Formato objeto historico com múltiplos turnos zerados
  const objetoZerados = {
    historico: [
      { speaker: 'IA', message: 'Olá, sou a Lívia da GEAP.', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'Cliente', message: 'Preciso de ajuda.', tempo_segundos: 0, tempo_formatado: '00:00' }
    ]
  };
  assert.equal(isTranscricaoInconsistente(objetoZerados), true);
  assert.equal(isTranscricaoInconsistente(JSON.stringify(objetoZerados)), true);

  // Formato objeto transcript ElevenLabs bruto com múltiplos turnos zerados
  const transcriptZerados = {
    transcript: [
      { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
      { role: 'user', message: 'Boleto', time_in_call_secs: 0 }
    ]
  };
  assert.equal(isTranscricaoInconsistente(transcriptZerados), true);

  // Turno com timestamp nulo
  const arrayComNulo = [
    { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
    { role: 'user', message: 'Ajuda', time_in_call_secs: null }
  ];
  assert.equal(isTranscricaoInconsistente(arrayComNulo), true);

  // Turno sem propriedade de tempo (undefined)
  const arraySemPropriedadeTempo = [
    { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
    { role: 'user', message: 'Ajuda' }
  ];
  assert.equal(isTranscricaoInconsistente(arraySemPropriedadeTempo), true);

  // Turno com timestamp não numérico inválido
  const arrayComStringInvalida = [
    { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
    { role: 'user', message: 'Ajuda', time_in_call_secs: 'não_numérico' }
  ];
  assert.equal(isTranscricaoInconsistente(arrayComStringInvalida), true);

  // Turno com timestamp negativo
  const arrayComNegativo = [
    { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
    { role: 'user', message: 'Ajuda', time_in_call_secs: -3 }
  ];
  assert.equal(isTranscricaoInconsistente(arrayComNegativo), true);
});

test('isTranscricaoInconsistente NAO seleciona atendimentos legitimos com apenas o primeiro turno em 00:00 e subsequentes positivos', () => {
  // Chamada de turno único com 00:00 (apenas apresentação)
  const turnoUnico = [
    { role: 'agent', message: 'Olá Lívia', time_in_call_secs: 0 }
  ];
  assert.equal(isTranscricaoInconsistente(turnoUnico), false);

  // Formato array com 1º turno em 00:00 e subsequentes positivos
  const arrayValido = [
    { role: 'agent', message: 'Olá, sou a Lívia da GEAP.', time_in_call_secs: 0 },
    { role: 'user', message: 'Gostaria de emitir boleto.', time_in_call_secs: 4 },
    { role: 'agent', message: 'Vou consultar para você.', time_in_call_secs: 12 },
    { role: 'agent', message: 'Aqui está.', time_in_call_secs: 25 }
  ];
  assert.equal(isTranscricaoInconsistente(arrayValido), false);
  assert.equal(isTranscricaoInconsistente(JSON.stringify(arrayValido)), false);

  // Formato objeto historico com 1º turno em 00:00 e subsequentes positivos
  const historicoValido = {
    historico: [
      { speaker: 'IA', message: 'Olá Lívia', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'Cliente', message: 'Preciso de boleto', tempo_segundos: 6, tempo_formatado: '00:06' },
      { speaker: 'IA', message: 'Enviado por e-mail', tempo_segundos: 18, tempo_formatado: '00:18' }
    ]
  };
  assert.equal(isTranscricaoInconsistente(historicoValido), false);
  assert.equal(isTranscricaoInconsistente(JSON.stringify(historicoValido)), false);

  // Formato com strings numéricas válidas
  const stringNumericaValida = [
    { role: 'agent', message: 'Olá', time_in_call_secs: '0' },
    { role: 'user', message: 'Segunda via', time_in_call_secs: '5.2' }
  ];
  assert.equal(isTranscricaoInconsistente(stringNumericaValida), false);

  // Formato objeto transcript ElevenLabs bruto com timestamps válidos
  const transcriptBrutoValido = {
    transcript: [
      { role: 'agent', message: 'Olá', time_in_call_secs: 0 },
      { role: 'user', message: 'Oi', time_in_call_secs: 7 }
    ]
  };
  assert.equal(isTranscricaoInconsistente(transcriptBrutoValido), false);
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

test('reprocessConversation substitui transcricoes legadas zeradas persistindo timestamps por turno normalizados', async () => {
  // Transcrição legada inconsistente com tempos zerados generalizados
  const legacyInconsistentTranscript = {
    historico: [
      { speaker: 'IA', message: 'Olá, sou a Lívia da GEAP.', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'Cliente', message: 'Gostaria de emitir minha segunda via.', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'IA', message: 'Vou consultar para você.', tempo_segundos: 0, tempo_formatado: '00:00' },
      { speaker: 'IA', message: 'Aqui está seu boleto.', tempo_segundos: 0, tempo_formatado: '00:00' }
    ]
  };

  const normalizedLegacy = normalizeTranscricao(legacyInconsistentTranscript);
  assert.equal(normalizedLegacy.every((turn) => turn.time_in_call_secs === 0), true);

  // Reprocessamento contra a API ElevenLabs obtém os timestamps reais
  let updatedPayload: string | undefined;
  const mockDb = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('update atendimentos')) {
        updatedPayload = values?.[0] as string;
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockElevenLabsApi = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-legacy-fix',
        status: 'done',
        transcript: [
          { role: 'agent', message: 'Olá, sou a Lívia da GEAP.', time_in_call_secs: 0 },
          { role: 'user', message: 'Gostaria de emitir minha segunda via.', time_in_call_secs: 6 },
          { role: 'agent', message: 'Vou consultar para você.', time_in_call_secs: 14 },
          { role: 'agent', message: 'Aqui está seu boleto.', time_in_call_secs: 32 }
        ]
      }),
      { status: 200 }
    );
  };

  const outcome = await reprocessConversation(mockDb as any, 'conv-legacy-fix', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key',
    fetchFn: mockElevenLabsApi
  });

  assert.equal(outcome.success, true);
  assert.ok(updatedPayload);

  // Normaliza o payload persistido no Postgres pós-reprocessamento
  const reprocessedJson = JSON.parse(updatedPayload);
  const normalizedReprocessed = normalizeTranscricao(reprocessedJson);

  assert.equal(normalizedReprocessed.length, 4);
  assert.deepEqual(
    normalizedReprocessed.map((turn) => ({
      role: turn.role,
      message: turn.message,
      time_in_call_secs: turn.time_in_call_secs
    })),
    [
      { role: 'agent', message: 'Olá, sou a Lívia da GEAP.', time_in_call_secs: 0 },
      { role: 'user', message: 'Gostaria de emitir minha segunda via.', time_in_call_secs: 6 },
      { role: 'agent', message: 'Vou consultar para você.', time_in_call_secs: 14 },
      { role: 'agent', message: 'Aqui está seu boleto.', time_in_call_secs: 32 }
    ]
  );
});


