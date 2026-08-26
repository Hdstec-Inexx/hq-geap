import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTranscricao,
  isTranscricaoInconsistente,
  calculateTempoEspera,
  extractCallDuration
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

test('findInconsistentConversationIdsQuery gera SQL que filtra atendimentos concluidos com corte temporal, rastreamento de tentativas, exclusao de ignorados e ordenacao ASC', () => {
  const query = findInconsistentConversationIdsQuery();
  assert.match(query, /status = 'concluido'/i);
  assert.match(query, /not reprocessamento_ignorado|reprocessamento_ignorado = false/i);
  assert.match(query, /reprocessamento_tentativas < 3/i);
  assert.match(query, /concluido_em < '2026-08-19'/i);
  assert.match(query, /order by concluido_em asc/i);
  assert.match(query, /limit \$1/i);
  assert.match(query, /transcricao is null/i);
  assert.match(query, /jsonb_typeof\(transcricao\) not in \('array', 'object'\)/i);
  assert.match(query, /jsonb_typeof\(transcricao\) = 'array'/i);
  assert.match(query, /jsonb_typeof\(transcricao->'historico'\) = 'array'/i);
  assert.match(query, /elevenlabs_conversation_id/i);
  assert.match(query, /time_in_call_secs/i);
  assert.match(query, /tempo_segundos/i);
  assert.match(query, /jsonb_array_length/i);

  const aliasedQuery = findInconsistentConversationIdsQuery({ tableAlias: 'a' });
  assert.match(aliasedQuery, /from atendimentos a/i);
  assert.match(aliasedQuery, /a\.elevenlabs_conversation_id/i);
  assert.match(aliasedQuery, /a\.status = 'concluido'/i);
  assert.match(aliasedQuery, /not a\.reprocessamento_ignorado|a\.reprocessamento_ignorado = false/i);
  assert.match(aliasedQuery, /a\.reprocessamento_tentativas < 3/i);
  assert.match(aliasedQuery, /a\.concluido_em < '2026-08-19'/i);
  assert.match(aliasedQuery, /order by a\.concluido_em asc/i);
  assert.match(aliasedQuery, /a\.transcricao is null/i);

  const forceQuery = findInconsistentConversationIdsQuery({ force: true });
  assert.match(forceQuery, /status = 'concluido'/i);
  assert.match(forceQuery, /not reprocessamento_ignorado|reprocessamento_ignorado = false/i);
  assert.match(forceQuery, /reprocessamento_tentativas < 3/i);
  assert.match(forceQuery, /concluido_em < '2026-08-19'/i);
  assert.match(forceQuery, /order by concluido_em asc/i);
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

test('reprocessConversation transforma transcript, recalcula duracao e tme e atualiza banco de forma transacional resetando contadores', async () => {
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
        metadata: {
          call_duration_secs: 145.8
        },
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
            message: 'Aqui está sua fatura.',
            time_in_call_secs: 15,
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

  const updateQuery = executedQueries.find((q) => q.text.includes('update atendimentos') && q.text.includes('transcricao'));
  assert.ok(updateQuery);
  assert.match(updateQuery.text, /transcricao\s*=\s*\$1::jsonb/i);
  assert.match(updateQuery.text, /duracao_segundos\s*=\s*\$2/i);
  assert.match(updateQuery.text, /tme_segundos\s*=\s*\$3/i);
  assert.match(updateQuery.text, /reprocessamento_tentativas\s*=\s*0/i);
  assert.match(updateQuery.text, /reprocessamento_ignorado\s*=\s*false/i);
  assert.match(updateQuery.text, /reprocessamento_ultimo_erro\s*=\s*null/i);
  assert.match(updateQuery.text, /atualizado_em\s*=\s*now\(\)/i);
  assert.match(updateQuery.text, /elevenlabs_conversation_id\s*=\s*\$4/i);
  assert.match(updateQuery.text, /status\s*=\s*'concluido'/i);

  // Garante que duracao_segundos e tme_segundos foram recalculados corretamente
  assert.equal(updateQuery.values?.[1], 146); // Math.round(145.8)
  assert.equal(updateQuery.values?.[2], 11);  // 15 - 4 = 11
  assert.equal(updateQuery.values?.[3], 'conv-abc');

  // Garante que a tabela avaliacoes nunca é alterada
  assert.equal(
    executedQueries.some((q) => q.text.toLowerCase().includes('avaliacoes')),
    false
  );

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
        message: 'Aqui está sua fatura.\n[Resultado da Ferramenta: consultar_boleto - Sucesso]',
        tempo_segundos: 15,
        tempo_formatado: '00:15'
      }
    ]
  });
});

test('reprocessConversation descarta imediatamente em caso de resposta HTTP 404 marcando reprocessamento_ignorado', async () => {
  const executedQueries: Array<{ text: string; values?: unknown[] }> = [];

  const mockDb = {
    query: async (text: string, values?: unknown[]) => {
      executedQueries.push({ text, values });
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ detail: 'Conversation not found' }), {
      status: 404,
      statusText: 'Not Found'
    });
  };

  const outcome = await reprocessConversation(mockDb as any, 'conv-404-discard', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key',
    fetchFn: mockFetch
  });

  assert.equal(outcome.success, false);
  assert.equal(outcome.conversationId, 'conv-404-discard');
  assert.equal(outcome.ignored, true);
  assert.match(outcome.error ?? '', /404/i);

  const updateQuery = executedQueries.find((q) => q.text.includes('update atendimentos'));
  assert.ok(updateQuery, 'Deve executar update na tabela atendimentos para marcar descarte');
  assert.match(updateQuery.text, /reprocessamento_ignorado\s*=\s*true/i);
  assert.match(updateQuery.text, /reprocessamento_ultimo_erro\s*=\s*'404 Not Found'|\$1/i);
  assert.match(updateQuery.text, /atualizado_em\s*=\s*now\(\)/i);
  assert.match(updateQuery.text, /elevenlabs_conversation_id/i);
  assert.match(updateQuery.text, /status\s*=\s*'concluido'/i);

  // Garante que a tabela avaliacoes nunca é alterada
  assert.equal(
    executedQueries.some((q) => q.text.toLowerCase().includes('avaliacoes')),
    false,
    'Tabela avaliacoes nao pode ser alterada no descarte 404'
  );
});

test('reprocessConversation incrementa tentativas e persiste erro em falhas transitorias (5xx e rede)', async () => {
  const executedQueries: Array<{ text: string; values?: unknown[] }> = [];

  const mockDb = {
    query: async (text: string, values?: unknown[]) => {
      executedQueries.push({ text, values });
      return { rowCount: 1, rows: [] };
    }
  };

  // 1. Falha HTTP 500
  const mockFetch500: typeof fetch = async () => {
    return new Response(JSON.stringify({ detail: 'Internal Server Error' }), {
      status: 500,
      statusText: 'Internal Server Error'
    });
  };

  const outcome500 = await reprocessConversation(mockDb as any, 'conv-500-transient', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key',
    fetchFn: mockFetch500
  });

  assert.equal(outcome500.success, false);
  assert.equal(outcome500.conversationId, 'conv-500-transient');
  assert.equal(outcome500.ignored ?? false, false);
  assert.match(outcome500.error ?? '', /500/i);

  const update500 = executedQueries.find(
    (q) => q.text.includes('update atendimentos') && q.values?.includes('conv-500-transient')
  );
  assert.ok(update500, 'Deve executar update para registrar falha 500');
  assert.match(update500.text, /reprocessamento_tentativas\s*=\s*reprocessamento_tentativas\s*\+\s*1/i);
  assert.match(update500.text, /reprocessamento_ultimo_erro/i);
  assert.match(update500.text, /elevenlabs_conversation_id/i);

  // 2. Falha de rede / Timeout (exceção no fetch)
  const mockFetchNetworkError: typeof fetch = async () => {
    throw new Error('fetch failed: connection timeout');
  };

  const outcomeNetwork = await reprocessConversation(mockDb as any, 'conv-net-err', {
    apiUrl: 'https://api.elevenlabs.io',
    apiKey: 'test-key',
    fetchFn: mockFetchNetworkError
  });

  assert.equal(outcomeNetwork.success, false);
  assert.equal(outcomeNetwork.conversationId, 'conv-net-err');
  assert.match(outcomeNetwork.error ?? '', /connection timeout|fetch failed/i);

  const updateNetwork = executedQueries.find(
    (q) => q.text.includes('update atendimentos') && q.values?.includes('conv-net-err')
  );
  assert.ok(updateNetwork, 'Deve executar update para registrar erro de rede');
  assert.match(updateNetwork.text, /reprocessamento_tentativas\s*=\s*reprocessamento_tentativas\s*\+\s*1/i);

  // Garante que a tabela avaliacoes nunca é alterada
  assert.equal(
    executedQueries.some((q) => q.text.toLowerCase().includes('avaliacoes')),
    false,
    'Tabela avaliacoes nao pode ser alterada em falhas transitorias'
  );
});

test('runPass suporta lista pontual de conversation IDs e executa em lote com metricas claras', async () => {
  const executedUpdates: string[] = [];

  const mockDb = {
    connect: async () => {},
    end: async () => {},
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('update atendimentos') && text.includes('transcricao')) {
        executedUpdates.push(values?.[3] as string);
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

test('extractCallDuration extrai a duracao em segundos inteiros de diferentes formatos de payload', () => {
  // Formato padrao ElevenLabs com metadata
  assert.equal(extractCallDuration({ metadata: { call_duration_secs: 252.4 } }), 252);
  assert.equal(extractCallDuration({ metadata: { call_duration_secs: 0 } }), 0);

  // Formato aninhado sob data
  assert.equal(extractCallDuration({ data: { metadata: { call_duration_secs: 180 } } }), 180);
  assert.equal(extractCallDuration({ data: { call_duration_secs: 65 } }), 65);

  // Formato direto no root
  assert.equal(extractCallDuration({ call_duration_secs: 42 }), 42);
  assert.equal(extractCallDuration({ duracao_segundos: 120 }), 120);
  assert.equal(extractCallDuration({ duration_seconds: 300 }), 300);

  // Casos invalidos ou nulos
  assert.equal(extractCallDuration(null), null);
  assert.equal(extractCallDuration(undefined), null);
  assert.equal(extractCallDuration({}), null);
  assert.equal(extractCallDuration({ metadata: {} }), null);
  assert.equal(extractCallDuration({ metadata: { call_duration_secs: null } }), null);
  assert.equal(extractCallDuration({ metadata: { call_duration_secs: -10 } }), null);
  assert.equal(extractCallDuration({ metadata: { call_duration_secs: 'invalid' } }), null);
});

test('calculateTempoEspera deriva o intervalo entre 1a fala do cliente e 2a fala do agente', () => {
  // Caso de sucesso padrao: 1a fala cliente (5s), 2a fala agente (9s) -> 4s
  const standardConv = {
    transcript: [
      { role: 'agent', message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
      { role: 'user', message: 'Preciso de boleto.', time_in_call_secs: 5 },
      { role: 'agent', message: 'Vou emitir para você.', time_in_call_secs: 9 }
    ]
  };
  assert.equal(calculateTempoEspera(standardConv), 4);

  // Com timestamps fracionarios arredondados
  const fractionalConv = [
    { role: 'agent', message: 'Olá.', time_in_call_secs: 0 },
    { role: 'user', message: 'Oi.', time_in_call_secs: 5.5 },
    { role: 'agent', message: 'Como posso ajudar?', time_in_call_secs: 9 }
  ];
  assert.equal(calculateTempoEspera(fractionalConv), 4);

  // Formato historico (speaker IA / Cliente, tempo_segundos)
  const historicoConv = {
    historico: [
      { speaker: 'IA', message: 'Olá', tempo_segundos: 0 },
      { speaker: 'Cliente', message: 'Boleto', tempo_segundos: 8 },
      { speaker: 'IA', message: 'Consultando', tempo_segundos: 19 }
    ]
  };
  assert.equal(calculateTempoEspera(historicoConv), 11);

  // String JSON
  assert.equal(calculateTempoEspera(JSON.stringify(standardConv)), 4);

  // Ausente primeira fala do cliente -> null
  const noClient = [
    { role: 'agent', message: 'Olá.', time_in_call_secs: 0 },
    { role: 'agent', message: 'Ainda está aí?', time_in_call_secs: 10 }
  ];
  assert.equal(calculateTempoEspera(noClient), null);

  // Ausente segunda fala do agente (apenas apresentacao) -> null
  const onlyPresentation = [
    { role: 'agent', message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Oi.', time_in_call_secs: 5 }
  ];
  assert.equal(calculateTempoEspera(onlyPresentation), null);

  // Ausente apresentacao do agente (só 1 fala do agente após o cliente) -> null
  const noPresentation = [
    { role: 'user', message: 'Oi.', time_in_call_secs: 5 },
    { role: 'agent', message: 'Olá!', time_in_call_secs: 9 }
  ];
  assert.equal(calculateTempoEspera(noPresentation), null);

  // Intervalo negativo (anomalia de timestamp) -> null
  const negativeDelta = [
    { role: 'agent', message: 'Olá.', time_in_call_secs: 0 },
    { role: 'user', message: 'Oi.', time_in_call_secs: 15 },
    { role: 'agent', message: 'Resposta.', time_in_call_secs: 10 }
  ];
  assert.equal(calculateTempoEspera(negativeDelta), null);

  // Turnos intermediarios de ferramentas sem mensagem verbal nao interferem na contagem de falas verbais
  const withToolCalls = [
    { role: 'agent', message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
    { role: 'user', message: 'Gostaria do boleto.', time_in_call_secs: 6 },
    { role: 'agent', message: '', time_in_call_secs: 10, tool_calls: [{ tool_name: 'buscar' }] },
    { role: 'agent', message: 'Aqui está seu boleto.', time_in_call_secs: 18 }
  ];
  assert.equal(calculateTempoEspera(withToolCalls), 12);
});

test('reprocessConversation grava tme_segundos como null quando o atendimento nao possui a segunda fala do agente', async () => {
  let executedUpdate: { text: string; values?: unknown[] } | undefined;

  const mockDb = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('update atendimentos')) {
        executedUpdate = { text, values };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-only-pres',
        status: 'done',
        metadata: { call_duration_secs: 30 },
        transcript: [
          { role: 'agent', message: 'Olá, sou a Lívia da GEAP.', time_in_call_secs: 0 }
        ]
      }),
      { status: 200 }
    );
  };

  const outcome = await reprocessConversation(mockDb as any, 'conv-only-pres', {
    fetchFn: mockFetch
  });

  assert.equal(outcome.success, true);
  assert.ok(executedUpdate);
  assert.equal(executedUpdate.values?.[1], 30);   // duracao_segundos
  assert.equal(executedUpdate.values?.[2], null); // tme_segundos is null
  assert.equal(executedUpdate.values?.[3], 'conv-only-pres');
});

test('reprocessConversation garante rollback e preserva imutabilidade de avaliacoes quando ocorre erro no banco', async () => {
  const executedStatements: string[] = [];

  const mockDb = {
    query: async (text: string) => {
      executedStatements.push(text.trim().toLowerCase());
      if (text.includes('update atendimentos')) {
        throw new Error('database connection timeout');
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        conversation_id: 'conv-db-err',
        status: 'done',
        metadata: { call_duration_secs: 50 },
        transcript: [{ role: 'agent', message: 'Olá', time_in_call_secs: 0 }]
      }),
      { status: 200 }
    );
  };

  const outcome = await reprocessConversation(mockDb as any, 'conv-db-err', {
    fetchFn: mockFetch
  });

  assert.equal(outcome.success, false);
  assert.match(outcome.error ?? '', /database connection timeout/i);
  assert.ok(executedStatements.includes('begin'));
  assert.ok(executedStatements.includes('rollback'));
  assert.equal(executedStatements.includes('commit'), false);
  assert.equal(executedStatements.some((s) => s.includes('avaliacoes')), false);
});

test('runPass tolera falhas parciais e mantem isolamento transacional por item', async () => {
  const rolledBackConversations: string[] = [];
  const committedConversations: string[] = [];

  let currentConvId = '';
  const mockDb = {
    connect: async () => {},
    end: async () => {},
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('update atendimentos')) {
        currentConvId = values?.[3] as string;
        if (currentConvId === 'conv-fail-db') {
          throw new Error('simulated db failure');
        }
      }
      if (text.toLowerCase() === 'commit') {
        committedConversations.push(currentConvId);
      }
      if (text.toLowerCase() === 'rollback') {
        rolledBackConversations.push(currentConvId);
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('conv-fail-404')) {
      return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
    }
    return new Response(
      JSON.stringify({
        conversation_id: url.split('/').pop(),
        status: 'done',
        metadata: { call_duration_secs: 60 },
        transcript: [{ role: 'agent', message: 'Oi', time_in_call_secs: 0 }]
      }),
      { status: 200 }
    );
  };

  const result = await runPass({
    specificIds: ['conv-ok-1', 'conv-fail-db', 'conv-fail-404', 'conv-ok-2'],
    dbClient: mockDb as any,
    fetchFn: mockFetch
  });

  assert.equal(result.processed, 4);
  assert.equal(result.success, 2);
  assert.equal(result.failed, 2);
  assert.deepEqual(committedConversations, ['conv-ok-1', 'conv-ok-2']);
  assert.ok(rolledBackConversations.includes('conv-fail-db'));
});

