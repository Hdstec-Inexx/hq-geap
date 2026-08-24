import test from 'node:test';
import assert from 'node:assert/strict';
import { atendimentosQuerySchema } from '../../packages/contracts/src/atendimentos.js';
import {
  filaCuradoriaQuerySchema,
  curadoriasRealizadasQuerySchema
} from '../../packages/contracts/src/curadoria.js';

test('atendimentosQuerySchema aceita conversationId opcional e realiza trim', () => {
  const resultSem = atendimentosQuerySchema.safeParse({});
  assert.equal(resultSem.success, true);
  if (resultSem.success) {
    assert.equal(resultSem.data.conversationId, undefined);
  }

  const resultCom = atendimentosQuerySchema.safeParse({
    conversationId: '  conv-123-abc  '
  });
  assert.equal(resultCom.success, true);
  if (resultCom.success) {
    assert.equal(resultCom.data.conversationId, 'conv-123-abc');
  }

  const resultInvalido = atendimentosQuerySchema.safeParse({
    conversationId: ''
  });
  assert.equal(resultInvalido.success, false);
});

test('filaCuradoriaQuerySchema aceita conversationId opcional e realiza trim', () => {
  const resultSem = filaCuradoriaQuerySchema.safeParse({});
  assert.equal(resultSem.success, true);
  if (resultSem.success) {
    assert.equal(resultSem.data.conversationId, undefined);
  }

  const resultCom = filaCuradoriaQuerySchema.safeParse({
    conversationId: '  conv-fila-999  '
  });
  assert.equal(resultCom.success, true);
  if (resultCom.success) {
    assert.equal(resultCom.data.conversationId, 'conv-fila-999');
  }

  const resultInvalido = filaCuradoriaQuerySchema.safeParse({
    conversationId: ''
  });
  assert.equal(resultInvalido.success, false);
});

test('curadoriasRealizadasQuerySchema aceita conversationId opcional e realiza trim', () => {
  const resultSem = curadoriasRealizadasQuerySchema.safeParse({});
  assert.equal(resultSem.success, true);
  if (resultSem.success) {
    assert.equal(resultSem.data.conversationId, undefined);
  }

  const resultCom = curadoriasRealizadasQuerySchema.safeParse({
    conversationId: '  conv-realizada-777  '
  });
  assert.equal(resultCom.success, true);
  if (resultCom.success) {
    assert.equal(resultCom.data.conversationId, 'conv-realizada-777');
  }

  const resultInvalido = curadoriasRealizadasQuerySchema.safeParse({
    conversationId: ''
  });
  assert.equal(resultInvalido.success, false);
});

test('buildDetalhamentoFilters aplica filtro SQL ILIKE para conversationId', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      conversationId: 'conv-123'
    }),
    1
  );

  assert.equal(filtro.clauses.length, 1);
  assert.match(
    filtro.clauses[0]!,
    /a\.elevenlabs_conversation_id ilike '%' \|\| \$1 \|\| '%'/
  );
  assert.deepEqual(filtro.values, ['conv-123']);
});

test('buildFilaCuradoriaFilters aplica filtro SQL ILIKE para conversationId', async () => {
  const { buildFilaCuradoriaFilters } = await import(
    '../../apps/api/src/modules/curadoria/repository.js'
  );

  const filtro = buildFilaCuradoriaFilters(
    {
      conversationId: 'fila-abc'
    },
    2
  );

  assert.equal(filtro.clauses.length, 1);
  assert.match(
    filtro.clauses[0]!,
    /a\.elevenlabs_conversation_id ilike '%' \|\| \$2 \|\| '%'/
  );
  assert.deepEqual(filtro.values, ['fila-abc']);
});

test('buildCuradoriasRealizadasFilters aplica filtro SQL ILIKE para conversationId', async () => {
  const { buildCuradoriasRealizadasFilters } = await import(
    '../../apps/api/src/modules/curadoria/repository.js'
  );

  const filtro = buildCuradoriasRealizadasFilters(
    {
      conversationId: 'realizada-xyz'
    },
    3
  );

  assert.equal(filtro.clauses.length, 1);
  assert.match(
    filtro.clauses[0]!,
    /a\.elevenlabs_conversation_id ilike '%' \|\| \$3 \|\| '%'/
  );
  assert.deepEqual(filtro.values, ['realizada-xyz']);
});

test('telas de Atendimentos, FilaCuradoria e CuradoriasRealizadas implementam campo ID da conversa e limpeza', async () => {
  const { readFile } = await import('node:fs/promises');

  const pages = [
    {
      path: '../../apps/web/src/features/atendimentos/AtendimentosPage.tsx',
      inputId: 'atendimentos-conversation-id-filtro'
    },
    {
      path: '../../apps/web/src/features/curadoria/FilaCuradoriaPage.tsx',
      inputId: 'curadoria-conversation-id-filtro'
    },
    {
      path: '../../apps/web/src/features/curadoria/CuradoriasRealizadasPage.tsx',
      inputId: 'curadorias-realizadas-conversation-id-filtro'
    }
  ];

  for (const page of pages) {
    const fileUrl = new URL(page.path, import.meta.url);
    const content = await readFile(fileUrl, 'utf-8');

    assert.match(
      content,
      /ID da conversa/,
      `${page.path} deve conter label 'ID da conversa'`
    );
    assert.match(
      content,
      new RegExp(`id="${page.inputId}"`),
      `${page.path} deve conter input com id '${page.inputId}'`
    );
    assert.match(
      content,
      /name="conversationId"/,
      `${page.path} deve conter input com name 'conversationId'`
    );
    assert.match(
      content,
      /conversationIdParam/,
      `${page.path} deve ler conversationId dos searchParams`
    );
    assert.match(
      content,
      /draftConversationId/,
      `${page.path} deve gerenciar draftConversationId`
    );
  }
});

test('styles.css inclui estilizacao para inputs de texto nos filtros', async () => {
  const { readFile } = await import('node:fs/promises');
  const cssUrl = new URL('../../apps/web/src/styles.css', import.meta.url);
  const cssContent = await readFile(cssUrl, 'utf-8');

  assert.match(
    cssContent,
    /\.curadoria-filters-fields input\[type="text"\],\s*\.atendimentos-filters-fields input\[type="text"\]/
  );
});


