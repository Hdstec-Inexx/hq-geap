import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  comentarioFilaSchema,
  filtroStatusComentarioSchema
} from '../../packages/contracts/src/comentarios.js';

test('fila de Comentarios aplica limite padrao e rejeita paginas excessivas', () => {
  const defaults = filtroStatusComentarioSchema.parse({ status: 'pendente' });
  assert.equal(defaults.limite, 50);
  assert.equal(defaults.cursor, undefined);

  assert.equal(
    filtroStatusComentarioSchema.safeParse({
      status: 'resolvido',
      limite: '101'
    }).success,
    false
  );
});

test('filtroStatusComentarioSchema valida datas, periodo e conversationId', () => {
  const valid = filtroStatusComentarioSchema.parse({
    status: 'pendente',
    inicio: '2026-08-10',
    fim: '2026-08-18',
    conversationId: '  conv-123  '
  });
  assert.equal(valid.inicio, '2026-08-10');
  assert.equal(valid.fim, '2026-08-18');
  assert.equal(valid.conversationId, 'conv-123');

  // Defaultiza fim = inicio quando fim e omitido
  const singleDay = filtroStatusComentarioSchema.parse({
    inicio: '2026-08-15'
  });
  assert.equal(singleDay.inicio, '2026-08-15');
  assert.equal(singleDay.fim, '2026-08-15');

  // Rejeita fim sem inicio
  assert.equal(
    filtroStatusComentarioSchema.safeParse({ fim: '2026-08-18' }).success,
    false
  );

  // Rejeita inicio posterior a fim
  assert.equal(
    filtroStatusComentarioSchema.safeParse({
      inicio: '2026-08-18',
      fim: '2026-08-10'
    }).success,
    false
  );

  // Rejeita periodo superior a 1 ano
  assert.equal(
    filtroStatusComentarioSchema.safeParse({
      inicio: '2025-01-01',
      fim: '2026-01-02'
    }).success,
    false
  );

  // Rejeita data invalida
  assert.equal(
    filtroStatusComentarioSchema.safeParse({
      inicio: 'invalid-date'
    }).success,
    false
  );
});

test('comentarioFilaSchema inclui iniciadoEm e concluidoEm no atendimento', () => {
  const valid = {
    id: '11111111-1111-4111-8111-111111111111',
    atendimentoId: '22222222-2222-4222-8222-222222222222',
    texto: 'Comentario de teste',
    status: 'pendente',
    autor: {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Curador Teste'
    },
    resolucao: null,
    criadoEm: '2026-08-18T10:00:00.000Z',
    atendimento: {
      id: '22222222-2222-4222-8222-222222222222',
      conversationId: 'conv-abc-123',
      agenteVozNome: 'Livia',
      iniciadoEm: '2026-08-18T09:50:00.000Z',
      concluidoEm: '2026-08-18T09:55:00.000Z'
    }
  };

  const parsed = comentarioFilaSchema.parse(valid);
  assert.equal(parsed.atendimento.iniciadoEm, '2026-08-18T09:50:00.000Z');
  assert.equal(parsed.atendimento.concluidoEm, '2026-08-18T09:55:00.000Z');

  // Aceita null para iniciadoEm e concluidoEm
  const parsedNulls = comentarioFilaSchema.parse({
    ...valid,
    atendimento: {
      ...valid.atendimento,
      iniciadoEm: null,
      concluidoEm: null
    }
  });
  assert.equal(parsedNulls.atendimento.iniciadoEm, null);
  assert.equal(parsedNulls.atendimento.concluidoEm, null);

  // Rejeita quando iniciadoEm e omitido
  assert.equal(
    comentarioFilaSchema.safeParse({
      ...valid,
      atendimento: {
        id: valid.atendimento.id,
        conversationId: valid.atendimento.conversationId,
        agenteVozNome: valid.atendimento.agenteVozNome
      }
    }).success,
    false
  );
});

test('buildComentariosFilaFilters aplica dia civil America/Sao_Paulo, conversationId e cursor', async () => {
  const { buildComentariosFilaFilters } = await import(
    '../../apps/api/src/modules/comentarios/repository.js'
  );

  const diaUnico = buildComentariosFilaFilters({
    status: 'pendente',
    inicio: '2026-08-18'
  });
  assert.match(
    diaUnico.clauses.join(' and '),
    /c\.status = \$1/
  );
  assert.match(
    diaUnico.clauses.join(' and '),
    /c\.criado_em at time zone 'America\/Sao_Paulo' >= \$2::date/
  );
  assert.match(
    diaUnico.clauses.join(' and '),
    /c\.criado_em at time zone 'America\/Sao_Paulo' < \$3::date \+ interval '1 day'/
  );
  assert.deepEqual(diaUnico.values, ['pendente', '2026-08-18', '2026-08-18']);

  const periodoEConversa = buildComentariosFilaFilters({
    status: 'resolvido',
    inicio: '2026-08-01',
    fim: '2026-08-18',
    conversationId: 'conv-test-xyz',
    cursor: '11111111-1111-4111-8111-111111111111'
  });
  const sql = periodoEConversa.clauses.join(' and ');
  assert.match(sql, /c\.status = \$1/);
  assert.match(
    sql,
    /\(c\.criado_em, c\.id\) > \(\s*select cursor\.criado_em, cursor\.id\s*from comentarios cursor\s*where cursor\.id = \$2::uuid\s*\)/
  );
  assert.match(
    sql,
    /c\.criado_em at time zone 'America\/Sao_Paulo' >= \$3::date and c\.criado_em at time zone 'America\/Sao_Paulo' < \$4::date \+ interval '1 day'/
  );
  assert.match(sql, /a\.elevenlabs_conversation_id ilike '%' \|\| \$5 \|\| '%'/);
  assert.deepEqual(periodoEConversa.values, [
    'resolvido',
    '11111111-1111-4111-8111-111111111111',
    '2026-08-01',
    '2026-08-18',
    'conv-test-xyz'
  ]);
});

test('toComentarioFila mapeia iniciadoEm e concluidoEm do atendimento', async () => {
  const { toComentarioFila } = await import(
    '../../apps/api/src/modules/comentarios/service.js'
  );

  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    atendimentoId: '22222222-2222-4222-8222-222222222222',
    texto: 'Texto do comentario',
    status: 'pendente' as const,
    autorId: '33333333-3333-4333-8333-333333333333',
    autorNome: 'Autor Teste',
    resolvidoPorId: null,
    resolvidoPorNome: null,
    resolvidoEm: null,
    criadoEm: new Date('2026-08-18T10:00:00.000Z'),
    conversationId: 'conv-123',
    agenteVozNome: 'Livia',
    iniciadoEm: new Date('2026-08-18T09:50:00.000Z'),
    concluidoEm: new Date('2026-08-18T09:55:00.000Z')
  };

  const comentario = toComentarioFila(row);
  assert.equal(comentario.atendimento.iniciadoEm, '2026-08-18T09:50:00.000Z');
  assert.equal(comentario.atendimento.concluidoEm, '2026-08-18T09:55:00.000Z');

  const rowNulls = {
    ...row,
    iniciadoEm: null,
    concluidoEm: null
  };
  const comentarioNulls = toComentarioFila(rowNulls);
  assert.equal(comentarioNulls.atendimento.iniciadoEm, null);
  assert.equal(comentarioNulls.atendimento.concluidoEm, null);
});

test('formatComentarioAtendimentoHeader formata agente e data do atendimento', async () => {
  const { formatComentarioAtendimentoHeader } = await import(
    '../../apps/web/src/features/admin/comentarios/comentarios-fila-logic.js'
  );

  const comIniciado = formatComentarioAtendimentoHeader(
    'Livia',
    '2026-08-18T13:15:00.000Z',
    '2026-08-18T13:20:00.000Z'
  );
  assert.match(comIniciado, /^Livia · \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);

  const comConcluido = formatComentarioAtendimentoHeader(
    'Livia',
    null,
    '2026-08-18T13:20:00.000Z'
  );
  assert.match(comConcluido, /^Livia · \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);

  const semData = formatComentarioAtendimentoHeader('Livia', null, null);
  assert.equal(semData, 'Livia');
});

test('ComentariosPendentesPage inclui formulario de filtros, campos e cabeçalho de card', async () => {
  const pageContent = await readFile(
    new URL(
      '../../apps/web/src/features/admin/comentarios/ComentariosPendentesPage.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(pageContent, /name="inicio"/);
  assert.match(pageContent, /name="fim"/);
  assert.match(pageContent, /name="conversationId"/);
  assert.match(pageContent, /name="status"/);
  assert.match(pageContent, /Filtrar/);
  assert.match(pageContent, /Limpar filtros/);
  assert.match(pageContent, /formatComentarioAtendimentoHeader/);
  assert.match(pageContent, /comentario\.atendimento\.conversationId/);
});

async function readPaginationMigration() {
  return readFile(
    new URL(
      '../../db/migrations/0009_paginar_fila_comentarios.sql',
      import.meta.url
    ),
    'utf8'
  );
}

test('nova migration normaliza resolucoes legadas antes de exigir consistencia', async () => {
  const migration = await readPaginationMigration();

  const backfillPosition = migration.indexOf('update comentarios');
  const constraintPosition = migration.indexOf(
    'add constraint comentarios_resolucao_consistente'
  );
  assert.ok(backfillPosition >= 0);
  assert.ok(backfillPosition < constraintPosition);
  assert.match(migration, /status = 'pendente'/);
  assert.match(migration, /resolvido_por = null/);
  assert.match(migration, /resolvido_em = null/);
});

test('nova migration substitui o indice de status pelo indice composto', async () => {
  const migration = await readPaginationMigration();

  assert.match(migration, /drop index idx_comentarios_status/);
  assert.match(migration, /on comentarios\(status, criado_em, id\)/);
});
