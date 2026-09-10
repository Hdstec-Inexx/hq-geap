import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atendimentosQuerySchema } from '../../packages/contracts/src/atendimentos.js';
import { curadoriasRealizadasQuerySchema } from '../../packages/contracts/src/curadoria.js';

test('atendimentosQuerySchema aceita notaMin opcional em multiplos de 0,5 e trata ausente como sem piso', () => {
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

test('buildDetalhamentoFilters nao restringe por nota quando notaMin e 0 ou omitido', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const omitted = buildDetalhamentoFilters(atendimentosQuerySchema.parse({}));
  assert.equal(omitted.clauses.length, 0);

  const zero = buildDetalhamentoFilters(atendimentosQuerySchema.parse({ notaMin: 0 }));
  assert.equal(zero.clauses.length, 0);
});

test('buildDetalhamentoFilters aplica piso inclusivo da Nota da IA Avaliadora', async () => {
  const { buildDetalhamentoFilters } = await import(
    '../../apps/api/src/modules/atendimentos/detalhamentoFilters.js'
  );

  const filtro = buildDetalhamentoFilters(
    atendimentosQuerySchema.parse({ notaMin: 7 }),
    1
  );

  assert.equal(filtro.clauses.length, 1);
  assert.match(filtro.clauses[0]!, /ia\.autor = 'ia'/);
  assert.match(filtro.clauses[0]!, /ia\.nota >= \$1/);
  assert.doesNotMatch(filtro.clauses[0]!, /avaliacoes_curador/);
  assert.deepEqual(filtro.values, [7]);
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
    1
  );

  assert.equal(filtro.clauses.length, 2);
  assert.match(filtro.clauses[0]!, /elevenlabs_conversation_id/);
  assert.match(filtro.clauses[1]!, /ia\.nota >= \$2/);
  assert.deepEqual(filtro.values, ['conv-123', 6.5]);
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

test('notaMinQueryForRequest envia o parametro cru da URL inclusive quando invalido, e omite 0', async () => {
  const { notaMinQueryForRequest } = await import(
    '../../apps/web/src/features/atendimentos/nota-ia-filtro-logic.js'
  );

  assert.equal(notaMinQueryForRequest(new URLSearchParams()), undefined);
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=0')), undefined);
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=7')), '7');
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=7.3')), '7.3');
  assert.equal(notaMinQueryForRequest(new URLSearchParams('notaMin=11')), '11');
});

test('parseNotaMinParam le o piso da URL e volta a 0 quando ausente ou invalido', async () => {
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

test('formatNotaMinDisplay formata o piso em pt-BR', async () => {
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
  assert.match(page, /notaMinQueryForRequest/);
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
  assert.match(page, /notaMinQueryForRequest/);
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
  assert.match(realizadas, /notaMinQueryForRequest/);
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
