import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildFilaAtendimentoHref,
  countPendingComentarios,
  determineQueueAdvanceTarget,
  extractQueueFiltersFromFromParam,
  getAtendimentoBackLink,
  isDashboardOrigin,
  isMaintenanceQueueOrigin
} from '../../apps/web/src/features/admin/comentarios/comentarios-fila-logic.js';
import type { ComentarioFila } from '../../packages/contracts/src/comentarios.js';

test('buildFilaAtendimentoHref propaga contexto da Fila de Manutencao via URL', () => {
  // Sem parametros na fila -> from=/admin/comentarios
  const emptyParams = new URLSearchParams();
  const hrefEmpty = buildFilaAtendimentoHref('atendimento-1', emptyParams);
  assert.equal(
    hrefEmpty,
    '/atendimentos/atendimento-1?from=%2Fadmin%2Fcomentarios'
  );

  // Com filtros de status, data e ID de conversa
  const withFilters = new URLSearchParams({
    status: 'pendente',
    inicio: '2026-08-01',
    fim: '2026-08-20',
    conversationId: 'conv-123'
  });
  const hrefWithFilters = buildFilaAtendimentoHref('atendimento-2', withFilters);
  const parsed = new URL(hrefWithFilters, 'http://localhost');
  assert.equal(parsed.pathname, '/atendimentos/atendimento-2');
  assert.equal(
    parsed.searchParams.get('from'),
    '/admin/comentarios?status=pendente&inicio=2026-08-01&fim=2026-08-20&conversationId=conv-123'
  );
});

test('isMaintenanceQueueOrigin e isDashboardOrigin identificam origens contextuais', () => {
  assert.equal(isMaintenanceQueueOrigin('/admin/comentarios'), true);
  assert.equal(
    isMaintenanceQueueOrigin('/admin/comentarios?status=pendente'),
    true
  );
  assert.equal(
    isMaintenanceQueueOrigin('/admin/comentarios?inicio=2026-08-01&conversationId=conv'),
    true
  );
  assert.equal(isMaintenanceQueueOrigin('/atendimentos'), false);
  assert.equal(isMaintenanceQueueOrigin('/curadoria'), false);
  assert.equal(isMaintenanceQueueOrigin(null), false);
  assert.equal(isMaintenanceQueueOrigin(undefined), false);
  assert.equal(isMaintenanceQueueOrigin('//evil.com/admin/comentarios'), false);

  assert.equal(isDashboardOrigin('/'), true);
  assert.equal(isDashboardOrigin('/?inicio=2026-08-01&fim=2026-08-20'), true);
  assert.equal(isDashboardOrigin('/dashboard'), true);
  assert.equal(isDashboardOrigin('/gestao/dashboard?inicio=2026-08-01'), true);
  assert.equal(isDashboardOrigin('/atendimentos'), false);
  assert.equal(isDashboardOrigin(null), false);
  assert.equal(isDashboardOrigin('//evil.com'), false);
});

test('getAtendimentoBackLink define rota e texto conforme origem contextual', () => {
  // Acessado a partir do Dashboard com filtros de período
  const searchFromDashboard = new URLSearchParams({
    from: '/?inicio=2026-08-01&fim=2026-08-20'
  });
  const backDashboard = getAtendimentoBackLink(searchFromDashboard);
  assert.equal(backDashboard.label, 'Voltar ao Dashboard');
  assert.equal(backDashboard.to, '/?inicio=2026-08-01&fim=2026-08-20');

  // Acessado a partir do Dashboard da gestão sem querystring
  const searchFromGestaoDashboard = new URLSearchParams({
    from: '/gestao/dashboard'
  });
  const backGestaoDashboard = getAtendimentoBackLink(searchFromGestaoDashboard);
  assert.equal(backGestaoDashboard.label, 'Voltar ao Dashboard');
  assert.equal(backGestaoDashboard.to, '/gestao/dashboard');

  // Acessado a partir da Fila de Manutenção com filtros
  const searchFromFila = new URLSearchParams({
    from: '/admin/comentarios?status=pendente&inicio=2026-08-10&fim=2026-08-15'
  });
  const backFila = getAtendimentoBackLink(searchFromFila);
  assert.equal(backFila.label, 'Voltar à Fila de Manutenção');
  assert.equal(
    backFila.to,
    '/admin/comentarios?status=pendente&inicio=2026-08-10&fim=2026-08-15'
  );

  // Acessado a partir da Fila de Manutenção sem filtros adicionais
  const searchFromFilaSimples = new URLSearchParams({
    from: '/admin/comentarios'
  });
  const backFilaSimples = getAtendimentoBackLink(searchFromFilaSimples);
  assert.equal(backFilaSimples.label, 'Voltar à Fila de Manutenção');
  assert.equal(backFilaSimples.to, '/admin/comentarios');

  // Acessado a partir da listagem geral de Atendimentos com filtros
  const searchAtendimentos = new URLSearchParams({
    page: '2',
    inicio: '2026-08-01',
    motivo: 'Dúvidas'
  });
  const backAtendimentos = getAtendimentoBackLink(searchAtendimentos);
  assert.equal(backAtendimentos.label, 'Voltar à lista');
  assert.equal(
    backAtendimentos.to,
    '/atendimentos?page=2&inicio=2026-08-01&motivo=D%C3%BAvidas'
  );

  // Rejeita tentativas de open redirect com //
  const searchOpenRedirect = new URLSearchParams({
    from: '//external-site.com/phishing'
  });
  const backOpenRedirect = getAtendimentoBackLink(searchOpenRedirect);
  assert.equal(backOpenRedirect.label, 'Voltar à lista');
  assert.equal(backOpenRedirect.to, '/atendimentos');

  // Acesso direto sem query string
  const emptySearch = new URLSearchParams();
  const backEmpty = getAtendimentoBackLink(emptySearch);
  assert.equal(backEmpty.label, 'Voltar à lista');
  assert.equal(backEmpty.to, '/atendimentos');
});

test('extractQueueFiltersFromFromParam extrai filtros de status, datas e conversationId', () => {
  const filters = extractQueueFiltersFromFromParam(
    '/admin/comentarios?status=pendente&inicio=2026-08-01&fim=2026-08-20&conversationId=conv-test'
  );
  assert.deepEqual(filters, {
    status: 'pendente',
    inicio: '2026-08-01',
    fim: '2026-08-20',
    conversationId: 'conv-test'
  });

  const simple = extractQueueFiltersFromFromParam('/admin/comentarios');
  assert.deepEqual(simple, {
    status: 'pendente',
    inicio: undefined,
    fim: undefined,
    conversationId: undefined
  });
});

test('determineQueueAdvanceTarget redireciona para proximo atendimento ou retorna a fila em dia', () => {
  const currentAtendimentoId = '11111111-1111-4111-8111-111111111111';
  const nextAtendimentoId = '22222222-2222-4222-8222-222222222222';
  const fromUrl = '/admin/comentarios?status=pendente&inicio=2026-08-10';

  const mockItemNext: ComentarioFila = {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    atendimentoId: nextAtendimentoId,
    texto: 'Comentario pendente no proximo',
    status: 'pendente',
    autor: { id: '33333333-3333-4333-8333-333333333333', nome: 'Curador 1' },
    resolucao: null,
    criadoEm: '2026-08-10T10:00:00.000Z',
    atendimento: {
      id: nextAtendimentoId,
      conversationId: 'conv-next-1',
      agenteVozNome: 'Livia',
      iniciadoEm: '2026-08-10T09:50:00.000Z',
      concluidoEm: '2026-08-10T09:55:00.000Z'
    }
  };

  // Ha outro atendimento com comentario pendente na fila
  const targetAdvance = determineQueueAdvanceTarget(
    currentAtendimentoId,
    [mockItemNext],
    fromUrl
  );
  assert.equal(targetAdvance.type, 'advance');
  assert.equal(
    targetAdvance.to,
    `/atendimentos/${nextAtendimentoId}?from=${encodeURIComponent(fromUrl)}`
  );

  // Fila zerada / sem outros atendimentos pendentes -> retorna a fila de manutencao
  const targetReturnEmpty = determineQueueAdvanceTarget(
    currentAtendimentoId,
    [],
    fromUrl
  );
  assert.equal(targetReturnEmpty.type, 'return_to_queue');
  assert.equal(targetReturnEmpty.to, fromUrl);

  // Fila retornou apenas itens do proprio atendimento que acabaram de ser resolvidos -> retorna a fila
  const mockItemCurrent: ComentarioFila = {
    ...mockItemNext,
    atendimentoId: currentAtendimentoId,
    atendimento: {
      ...mockItemNext.atendimento,
      id: currentAtendimentoId
    }
  };
  const targetReturnSame = determineQueueAdvanceTarget(
    currentAtendimentoId,
    [mockItemCurrent],
    fromUrl
  );
  assert.equal(targetReturnSame.type, 'return_to_queue');
  assert.equal(targetReturnSame.to, fromUrl);
});

test('countPendingComentarios contabiliza comentarios com status pendente', () => {
  assert.equal(
    countPendingComentarios([
      { status: 'pendente' },
      { status: 'resolvido' },
      { status: 'pendente' }
    ]),
    2
  );
  assert.equal(
    countPendingComentarios([{ status: 'resolvido' }, { status: 'resolvido' }]),
    0
  );
  assert.equal(countPendingComentarios([]), 0);
});

test('DashboardPage propaga da rota atual a querystring de origem no link para Atendimento', async () => {
  const dashboardContent = await readFile(
    new URL(
      '../../apps/web/src/features/dashboards/DashboardPage.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(dashboardContent, /from=\$\{encodeURIComponent\(fromUrl\)\}/);
});

test('ComentariosPendentesPage propaga from com contexto nos links para Atendimento', async () => {
  const pageContent = await readFile(
    new URL(
      '../../apps/web/src/features/admin/comentarios/ComentariosPendentesPage.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(pageContent, /buildFilaAtendimentoHref/);
});

test('AtendimentoPage exibe link contextual com getAtendimentoBackLink e propaga from ao ComentariosPanel', async () => {
  const pageContent = await readFile(
    new URL(
      '../../apps/web/src/features/atendimentos/AtendimentoPage.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(pageContent, /getAtendimentoBackLink/);
  assert.match(pageContent, /backLink\.to/);
  assert.match(pageContent, /backLink\.label/);
  assert.match(pageContent, /<ComentariosPanel/);
  assert.match(pageContent, /from=\{searchParams\.get\('from'\)\}/);
});

test('ComentariosPanel permite que Admin resolva comentarios e avanca na fila quando ultimo e concluido', async () => {
  const panelContent = await readFile(
    new URL(
      '../../apps/web/src/features/comentarios/ComentariosPanel.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(panelContent, /Marcar como resolvido/);
  assert.match(panelContent, /resolvendo|saving/i);
  assert.match(panelContent, /status === 'pendente'/);
  assert.match(panelContent, /from/);
});
