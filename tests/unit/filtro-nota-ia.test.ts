import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atendimentosQuerySchema } from '../../packages/contracts/src/atendimentos.js';
import { curadoriasRealizadasQuerySchema } from '../../packages/contracts/src/curadoria.js';

test('atendimentosQuerySchema aceita notaMin opcional em multiplos de 0,5 e trata ausente como sem filtro', () => {
  const omitted = atendimentosQuerySchema.safeParse({});
  assert.equal(omitted.success, true);
  if (omitted.success) {
    assert.equal(omitted.data.notaMin, undefined);
  }

  const zero = atendimentosQuerySchema.safeParse({ notaMin: '0' });
  assert.equal(zero.success, true);
  if (zero.success) {
    assert.equal(zero.data.notaMin, 0);
  }

  const half = atendimentosQuerySchema.safeParse({ notaMin: '6.5' });
  assert.equal(half.success, true);
  if (half.success) {
    assert.equal(half.data.notaMin, 6.5);
  }

  const ten = atendimentosQuerySchema.safeParse({ notaMin: 10 });
  assert.equal(ten.success, true);
  if (ten.success) {
    assert.equal(ten.data.notaMin, 10);
  }
});

test('atendimentosQuerySchema rejeita notaMin fora de 0-10 ou que nao e multiplo de 0,5', () => {
  assert.equal(atendimentosQuerySchema.safeParse({ notaMin: '7.3' }).success, false);
  assert.equal(atendimentosQuerySchema.safeParse({ notaMin: 11 }).success, false);
  assert.equal(atendimentosQuerySchema.safeParse({ notaMin: -0.5 }).success, false);
});

test('curadoriasRealizadasQuerySchema aceita notaMin com a mesma semantica da Fila e de Atendimentos', () => {
  const omitted = curadoriasRealizadasQuerySchema.parse({});
  assert.equal(omitted.notaMin, undefined);

  assert.equal(curadoriasRealizadasQuerySchema.parse({ notaMin: '0' }).notaMin, 0);
  assert.equal(curadoriasRealizadasQuerySchema.parse({ notaMin: '6.5' }).notaMin, 6.5);
  assert.equal(curadoriasRealizadasQuerySchema.parse({ notaMin: 10 }).notaMin, 10);

  assert.equal(curadoriasRealizadasQuerySchema.safeParse({ notaMin: '7.3' }).success, false);
  assert.equal(curadoriasRealizadasQuerySchema.safeParse({ notaMin: 11 }).success, false);
});

test('buildDetalhamentoFilters sem datas observa o mes civil corrente', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );
  const now = new Date('2026-09-10T18:00:00.000Z');

  const omitted = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({}),
    1,
    { now }
  );
  assert.equal(omitted.clauses.length, 1);
  assert.match(omitted.clauses[0]!, /a\.status = 'em_andamento'/);
  assert.match(omitted.clauses[0]!, /a\.status = 'concluido'/);
  assert.deepEqual(omitted.values, ['2026-09-01', '2026-09-30']);

  const zero = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({ notaMin: 0 }),
    1,
    { now }
  );
  assert.equal(zero.clauses.length, 1);
  assert.doesNotMatch(zero.clauses.join(' '), /ia\.nota/);
  assert.deepEqual(zero.values, ['2026-09-01', '2026-09-30']);

  const comPeriodo = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({ inicio: '2026-08-01', fim: '2026-08-31' }),
    1,
    { now }
  );
  assert.match(comPeriodo.clauses[0]!, /a\.status = 'concluido'/);
  assert.doesNotMatch(comPeriodo.clauses[0]!, /em_andamento/);
  assert.deepEqual(comPeriodo.values, ['2026-08-01', '2026-08-31']);
});

test('civilMonthBoundsAmericaSaoPaulo cobre virada de ano e dezembro', async () => {
  const { civilMonthBoundsAmericaSaoPaulo } = await import(
    '../../apps/api/src/modules/atendimentos/civilMonthBounds.js'
  );

  assert.deepEqual(
    civilMonthBoundsAmericaSaoPaulo(new Date('2026-01-01T02:00:00.000Z')),
    { inicio: '2025-12-01', fim: '2025-12-31' }
  );
  assert.deepEqual(
    civilMonthBoundsAmericaSaoPaulo(new Date('2026-01-01T03:00:00.000Z')),
    { inicio: '2026-01-01', fim: '2026-01-31' }
  );
});

test('buildDetalhamentoFilters aplica igualdade da Nota da IA Avaliadora', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({ notaMin: 7 }),
    1,
    { now: new Date('2026-09-10T18:00:00.000Z') }
  );

  assert.equal(filtro.clauses.length, 2);
  assert.match(filtro.clauses[0]!, /a\.status = 'concluido'/);
  assert.match(filtro.clauses[1]!, /ia\.autor = 'ia'/);
  assert.match(filtro.clauses[1]!, /ia\.nota = \$3/);
  assert.doesNotMatch(filtro.clauses[1]!, /ia\.nota >=/);
  assert.doesNotMatch(filtro.clauses[1]!, /avaliacoes_curador/);
  assert.deepEqual(filtro.values, ['2026-09-01', '2026-09-30', 7]);
});

test('buildDetalhamentoFilters combina notaMin com conversationId em AND', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      conversationId: 'conv-123',
      notaMin: 6.5
    }),
    1,
    { now: new Date('2026-09-10T18:00:00.000Z') }
  );

  assert.equal(filtro.clauses.length, 3);
  assert.match(filtro.clauses[1]!, /elevenlabs_conversation_id/);
  assert.match(filtro.clauses[2]!, /ia\.nota = \$4/);
  assert.deepEqual(filtro.values, ['2026-09-01', '2026-09-30', 'conv-123', 6.5]);
});

test('buildDetalhamentoFilters nao aplica notaMin no Detalhamento do Indicador', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({
      inicio: '2025-01-01',
      fim: '2025-01-31',
      indicador: 'volume',
      notaMin: 7
    })
  );

  assert.doesNotMatch(filtro.clauses.join(' '), /ia\.nota/);
  assert.deepEqual(filtro.values, ['2025-01-01', '2025-01-31']);
});

test('notaMinQueryForRequest envia so nota exata valida e omite 0 ou invalido', async () => {
  const { notaMinQueryForRequest } = await import(
    '../../apps/web/src/features/atendimentos/nota-ia-filtro-logic.js'
  );

  assert.equal(notaMinQueryForRequest(new URLSearchParams()), undefined);
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=0')), undefined);
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=7')), '7');
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=6.5')), '6.5');
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=7.3')), undefined);
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=11')), undefined);
});

test('stripInvalidNotaMin remove notaMin invalido da query e preserva o restante', async () => {
  const {
    isInvalidNotaMinParam,
    stripInvalidNotaMin,
    applyNotaMinQuery,
    applyDraftNotaMin,
    notaMinFilterActive
  } = await import('../../apps/web/src/features/atendimentos/nota-ia-filtro-logic.js');

  assert.equal(isInvalidNotaMinParam(new URLSearchParams()), false);
  assert.equal(isInvalidNotaMinParam(new URLSearchParams('notaMin=7')), false);
  assert.equal(isInvalidNotaMinParam(new URLSearchParams('notaMin=7.3')), true);
  assert.equal(isInvalidNotaMinParam(new URLSearchParams('notaMin=11')), true);

  assert.equal(stripInvalidNotaMin(new URLSearchParams('notaMin=7')), null);

  const cleaned = stripInvalidNotaMin(
    new URLSearchParams('conversationId=abc&notaMin=7.3&page=2')
  );
  assert.ok(cleaned);
  assert.equal(cleaned.get('notaMin'), null);
  assert.equal(cleaned.get('conversationId'), 'abc');
  assert.equal(cleaned.get('page'), '2');

  const invalidRequest = new URLSearchParams();
  applyNotaMinQuery(invalidRequest, new URLSearchParams('notaMin=7.3'));
  assert.equal(invalidRequest.get('notaMin'), null);

  const request = new URLSearchParams();
  applyNotaMinQuery(request, new URLSearchParams('notaMin=6.5'));
  assert.equal(request.get('notaMin'), '6.5');

  const draft = new URLSearchParams();
  applyDraftNotaMin(draft, 0);
  applyDraftNotaMin(draft, 7);
  assert.equal(draft.get('notaMin'), '7');

  assert.equal(notaMinFilterActive(0), false);
  assert.equal(notaMinFilterActive(7), true);
});

test('parseNotaMinParam le a nota exata da URL e volta a 0 quando ausente ou invalido', async () => {
  const { parseNotaMinParam } = await import(
    '../../apps/web/src/features/atendimentos/nota-ia-filtro-logic.js'
  );

  assert.equal(parseNotaMinParam(new URLSearchParams()), 0);
  assert.equal(parseNotaMinParam(new URLSearchParams('notaMin=0')), 0);
  assert.equal(parseNotaMinParam(new URLSearchParams('notaMin=7')), 7);
  assert.equal(parseNotaMinParam(new URLSearchParams('notaMin=6.5')), 6.5);
  assert.equal(parseNotaMinParam(new URLSearchParams('notaMin=7.3')), 0);
  assert.equal(parseNotaMinParam(new URLSearchParams('notaMin=11')), 0);
});

test('formatNotaMinDisplay formata a Nota da IA Avaliadora em pt-BR', async () => {
  const { formatNotaMinDisplay } = await import(
    '../../apps/web/src/features/atendimentos/nota-ia-filtro-logic.js'
  );

  assert.equal(formatNotaMinDisplay(0), '0');
  assert.equal(formatNotaMinDisplay(7), '7');
  assert.equal(formatNotaMinDisplay(6.5), '6,5');
});

test('listagem de Atendimentos usa o controle reutilizavel de Nota da IA Avaliadora', async () => {
  const { readFile } = await import('node:fs/promises');

  const page = await readFile(
    new URL('../../apps/web/src/features/atendimentos/AtendimentosPage.tsx', import.meta.url),
    'utf8'
  );
  assert.match(page, /<NotaIaAvaliadoraFiltro/);
  assert.match(page, /id="atendimentos-nota-ia-filtro"/);
  assert.match(page, /draftNotaMin/);
  assert.match(page, /parseNotaMinParam/);
  assert.match(page, /applyNotaMinQuery/);
  assert.match(page, /applyDraftNotaMin/);
  assert.match(page, /stripInvalidNotaMin/);
  assert.match(page, /notaMinParam/);

  const control = await readFile(
    new URL(
      '../../apps/web/src/features/atendimentos/NotaIaAvaliadoraFiltro.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(control, /Nota da IA Avaliadora/);
  assert.match(control, /type="range"/);
  assert.match(control, /min=\{0\}/);
  assert.match(control, /max=\{10\}/);
  assert.match(control, /step=\{0\.5\}/);
  assert.match(control, /name=\{name\}/);
  assert.match(control, /formatNotaMinDisplay/);

  const detalhamento = await readFile(
    new URL('../../apps/web/src/features/dashboards/detalhamento.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(detalhamento, /notaMin/);
});

test('Fila de Curadoria reusa o controle de Nota da IA Avaliadora e nao preenche datas do mes implicito', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(
    new URL('../../apps/web/src/features/curadoria/FilaCuradoriaPage.tsx', import.meta.url),
    'utf8'
  );
  assert.match(page, /<NotaIaAvaliadoraFiltro/);
  assert.match(page, /id="curadoria-nota-ia-filtro"/);
  assert.match(page, /draftNotaMin/);
  assert.match(page, /parseNotaMinParam/);
  assert.match(page, /applyNotaMinQuery/);
  assert.match(page, /applyDraftNotaMin/);
  assert.match(page, /stripInvalidNotaMin/);
  assert.match(page, /notaMinParam/);
  assert.match(page, /navigate\('\/curadoria'\)/);
  assert.doesNotMatch(page, /civilMonthBoundsAmericaSaoPaulo/);

  const realizadas = await readFile(
    new URL(
      '../../apps/web/src/features/curadoria/CuradoriasRealizadasPage.tsx',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(realizadas, /<NotaIaAvaliadoraFiltro/);
  assert.match(realizadas, /id="curadorias-realizadas-nota-ia-filtro"/);
  assert.match(realizadas, /draftNotaMin/);
  assert.match(realizadas, /parseNotaMinParam/);
  assert.match(realizadas, /applyNotaMinQuery/);
  assert.match(realizadas, /applyDraftNotaMin/);
  assert.match(realizadas, /stripInvalidNotaMin/);
  assert.match(realizadas, /notaMinParam/);
});

test('styles.css estiliza o slider de Nota da IA Avaliadora nas barras de filtro', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(
    new URL('../../apps/web/src/styles.css', import.meta.url),
    'utf8'
  );
  assert.match(
    css,
    /\.nota-ia-filtro input\[type="range"\]/
  );
  assert.doesNotMatch(css, /\.curadoria-filters-fields input\[type="range"\]/);
});
