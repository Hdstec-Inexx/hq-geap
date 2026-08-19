import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';
import aprovada from '../fixtures/avaliacoes/avaliacao-aprovada.json' with { type: 'json' };
import fixture from '../fixtures/elevenlabs/atendimento-concluido.json' with { type: 'json' };
import { authUsers } from '../support/auth-fixtures.js';
import {
  firstTurnFitsWithoutEmptyBox,
  longTranscript,
  shortTranscript,
  transcriptOverflows,
  transcriptScroll
} from '../support/transcript-scroll.js';

const apiUrl = 'http://127.0.0.1:3000';
const atendimento = fixture.normalized;
const ingestionHeaders = { 'x-ingestion-key': 'test-ingestion-key-with-at-least-32-chars' };
const { Client } = pg;

async function login(
  request: APIRequestContext,
  role: 'admin' | 'gestao' | 'curador'
) {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { token: string };
}

async function queryDatabase<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  const client = new Client({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test'
  });
  await client.connect();
  try {
    return await client.query<T>(text, values);
  } finally {
    await client.end();
  }
}

test.describe.serial('ingestao e consulta de Atendimentos', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia', 'agent-livia-test')
      on conflict (elevenlabs_agent_id) do nothing
    `);
  });

  test('rejeita credencial de ingestao invalida sem persistir estado', async ({
    request
  }) => {
    const response = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: { ...atendimento, conversation_id: 'conv-unauthorized' }
    });

    expect(response.status()).toBe(401);
    const persisted = await queryDatabase<{ count: string }>(
      'select count(*) from atendimentos where elevenlabs_conversation_id = $1',
      ['conv-unauthorized']
    );
    expect(persisted.rows[0]?.count).toBe('0');
  });

  test('rejeita agent_id desconhecido sem persistir estado parcial', async ({
    request
  }) => {
    const response = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: 'conv-unknown-agent',
        agent_id: 'agent-desconhecido'
      },
      headers: ingestionHeaders
    });

    expect(response.status()).toBe(422);
    const persisted = await queryDatabase<{ count: string }>(
      'select count(*) from atendimentos where elevenlabs_conversation_id = $1',
      ['conv-unknown-agent']
    );
    expect(persisted.rows[0]?.count).toBe('0');
  });

  test('converge reenvios no conversation_id sem duplicar Atendimento', async ({
    request
  }) => {
    const first = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: atendimento,
      headers: ingestionHeaders
    });
    expect(first.status()).toBe(201);
    const created = await first.json();
    const persistedMetrics = await queryDatabase<{
      tme_segundos: number | null;
      tools_executados: number;
      tools_sucesso: number;
    }>(
      `select tme_segundos, tools_executados, tools_sucesso
       from atendimentos
       where elevenlabs_conversation_id = $1`,
      [atendimento.conversation_id]
    );
    expect(persistedMetrics.rows[0]).toEqual({
      tme_segundos: atendimento.tme_seconds,
      tools_executados: atendimento.tool_executions.total,
      tools_sucesso: atendimento.tool_executions.successful
    });

    const replay = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: { ...atendimento, contact_reason: 'Segunda via de boleto' },
      headers: ingestionHeaders
    });
    expect(replay.status()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      id: created.id,
      conversationId: atendimento.conversation_id,
      motivoContato: 'Segunda via de boleto',
      status: 'concluido'
    });

    const secondReplay = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: atendimento,
      headers: ingestionHeaders
    });
    expect(secondReplay.status()).toBe(200);
    await expect(secondReplay.json()).resolves.toMatchObject({
      id: created.id,
      conversationId: atendimento.conversation_id,
      status: 'concluido'
    });

    await queryDatabase(`
      select * from persistir_avaliacao_ia(
        $1,
        (select id from prompts_ia_avaliadora where ativo),
        $2::jsonb,
        $3::jsonb,
        $4,
        $5,
        $6
      )
    `, [
      created.id,
      JSON.stringify(aprovada.checklist),
      JSON.stringify(aprovada.falhas_identificadas),
      aprovada.resumo_atendimento,
      aprovada.atendimento_aprovado,
      aprovada.nota_qualidade
    ]);

    const afterAvaliacao = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: atendimento,
      headers: ingestionHeaders
    });
    expect(afterAvaliacao.status()).toBe(200);

    const persisted = await queryDatabase<{
      agente_voz_id: string;
      count: string;
    }>(`
      select count(*)::text as count, min(agente_voz_id::text) as agente_voz_id
      from atendimentos
      where elevenlabs_conversation_id = $1
      group by elevenlabs_conversation_id
    `, [atendimento.conversation_id]);
    const avaliacoes = await queryDatabase<{ count: string }>(
      `select count(*)::text as count from avaliacoes
       where atendimento_id = $1 and autor = 'ia'`,
      [created.id]
    );
    const agent = await queryDatabase<{ id: string }>(
      'select id from agentes_voz where elevenlabs_agent_id = $1',
      [atendimento.agent_id]
    );
    expect(persisted.rows[0]).toEqual({
      agente_voz_id: agent.rows[0]?.id,
      count: '1'
    });
    expect(avaliacoes.rows[0]?.count).toBe('1');
  });

  test('permite em andamento para concluido e impede regressao', async ({
    request
  }) => {
    const conversationId = 'conv-lifecycle-001';
    const inProgress = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        conversation_id: conversationId,
        agent_id: atendimento.agent_id,
        event_timestamp: atendimento.event_timestamp - 100,
        status: 'em_andamento',
        started_at: atendimento.started_at,
        transcript: [],
        transferred: false
      },
      headers: ingestionHeaders
    });
    expect(inProgress.status()).toBe(201);

    const completed = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: { ...atendimento, conversation_id: conversationId },
      headers: ingestionHeaders
    });
    expect(completed.status()).toBe(200);

    const regression = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        conversation_id: conversationId,
        agent_id: atendimento.agent_id,
        event_timestamp: atendimento.event_timestamp - 100,
        status: 'em_andamento',
        started_at: atendimento.started_at,
        transcript: [],
        transferred: false
      },
      headers: ingestionHeaders
    });
    expect(regression.status()).toBe(409);

    const persisted = await queryDatabase<{
      concluido_em: Date;
      status: string;
    }>(
      'select status, concluido_em from atendimentos where elevenlabs_conversation_id = $1',
      [conversationId]
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'concluido',
      concluido_em: expect.any(Date)
    });
  });

  test('ignora evento antigo e nao regride Transferencia confirmada', async ({
    request
  }) => {
    const conversationId = 'conv-monotonic-001';
    const first = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: conversationId,
        transferred: true
      },
      headers: ingestionHeaders
    });
    expect(first.status()).toBe(201);

    const stale = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: conversationId,
        event_timestamp: atendimento.event_timestamp - 1,
        contact_reason: 'Evento antigo',
        transferred: false
      },
      headers: ingestionHeaders
    });
    expect(stale.status()).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({
      houveTransferencia: true,
      motivoContato: atendimento.contact_reason
    });

    const newer = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: conversationId,
        event_timestamp: atendimento.event_timestamp + 1,
        transferred: false
      },
      headers: ingestionHeaders
    });
    expect(newer.status()).toBe(200);
    await expect(newer.json()).resolves.toMatchObject({
      houveTransferencia: true
    });
  });

  test('lista e detalha metadados, transcricao e audio conforme o papel', async ({
    request
  }) => {
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');
    const curador = await login(request, 'curador');
    const headersFor = (token: string) => ({ authorization: `Bearer ${token}` });

    const listResponse = await request.get(`${apiUrl}/atendimentos`, {
      headers: headersFor(admin.token)
    });
    expect(listResponse.status()).toBe(200);
    const listPage = (await listResponse.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    const list = listPage.items;
    const summary = list.find(
      (item) => item.conversationId === atendimento.conversation_id
    );
    expect(summary).toMatchObject({
      agenteVoz: { agentId: atendimento.agent_id, nome: 'Lívia' },
      custo: atendimento.cost,
      duracaoSegundos: atendimento.duration_seconds,
      houveTransferencia: atendimento.transferred,
      motivoContato: atendimento.contact_reason,
      status: 'concluido'
    });
    expect(summary).not.toHaveProperty('transcricao');

    const limitedList = await request.get(
      `${apiUrl}/atendimentos?limit=1&offset=0`,
      { headers: headersFor(admin.token) }
    );
    expect(limitedList.status()).toBe(200);
    const limitedPage = (await limitedList.json()) as {
      items: unknown[];
      total: number;
    };
    expect(limitedPage.items).toHaveLength(1);
    expect(limitedPage.total).toBeGreaterThanOrEqual(1);
    const invalidPagination = await request.get(
      `${apiUrl}/atendimentos?limit=101`,
      { headers: headersFor(admin.token) }
    );
    expect(invalidPagination.status()).toBe(400);

    const id = summary?.id as string;
    for (const session of [admin, gestao]) {
      const response = await request.get(`${apiUrl}/atendimentos/${id}`, {
        headers: headersFor(session.token)
      });
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        audioUrl: expect.stringContaining(atendimento.audio_reference),
        custo: atendimento.cost,
        transcricao: [
          { role: 'agent', message: 'Olá, eu sou a Lívia. Como posso ajudar?', time_in_call_secs: 0 },
          { role: 'user', message: 'Preciso da segunda via do boleto.', time_in_call_secs: 8 },
          { role: 'agent', message: expect.stringContaining('Vou enviar o boleto'), time_in_call_secs: 19 }
        ]
      });
    }

    const curadorList = await request.get(`${apiUrl}/atendimentos`, {
      headers: headersFor(curador.token)
    });
    const curadorDetail = await request.get(`${apiUrl}/atendimentos/${id}`, {
      headers: headersFor(curador.token)
    });
    expect(JSON.stringify(await curadorList.json())).not.toContain('custo');
    expect(JSON.stringify(await curadorDetail.json())).not.toContain('custo');
  });

  test('Admin consulta lista e detalhe pela interface', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('link', { name: 'Consultar Atendimentos' }).click();

    await expect(page.getByRole('heading', { name: 'Atendimentos' })).toBeVisible();
    await page
      .getByRole('link', { name: new RegExp(atendimento.contact_reason!) })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: /Atendimento/ })).toBeVisible();
    await expect(page.getByText(atendimento.contact_reason!).first()).toBeVisible();
    await expect(page.getByText(/US\$\s*0,18/)).toBeVisible();
    await expect(page.getByText(/Preciso da segunda via do boleto/)).toBeVisible();
  });

  async function seedAtendimentosForPagination(prefix: string, count: number) {
    await queryDatabase(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, transcricao,
        audio_url, houve_transferencia, concluido_em, duracao_segundos,
        motivo_contato
      )
      select id, $1 || '-' || gs::text, 'concluido'::status_atendimento,
        '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
        'atendimentos/teste.mp3', false,
        now() - (gs * interval '1 minute'), 42, 'Rede credenciada'
      from agentes_voz
      cross join generate_series(1, $2::int) as gs
      where elevenlabs_agent_id = 'agent-livia-test'
    `, [prefix, count]);
  }

  test('pagina Atendimentos com numeros e preserva a pagina ao voltar do detalhe', async ({
    page
  }) => {
    await seedAtendimentosForPagination('conv-atendimentos-paginacao', 51);
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/atendimentos');

    const pager = page.getByRole('navigation', {
      name: 'Paginação dos Atendimentos'
    });
    const pageList = pager.locator('ol');
    await expect(pageList).toHaveCSS('display', 'flex');
    await expect(pageList).toHaveCSS('flex-wrap', 'wrap');
    await expect(pager.getByRole('link', { name: 'Página 2' })).toBeVisible();
    await pager.getByRole('link', { name: 'Página 2' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByRole('link', { name: 'Página 1' })).toBeVisible();
    await page.getByRole('link', { name: 'Rede credenciada' }).first().click();
    await page.getByRole('link', { name: 'Voltar à lista' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
  });

  async function createAtendimentoComTranscricao(
    conversationId: string,
    transcricao: unknown[]
  ) {
    const result = await queryDatabase<{ id: string }>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, transcricao,
        audio_url, houve_transferencia, concluido_em, duracao_segundos,
        motivo_contato
      )
      select id, $1, 'concluido'::status_atendimento,
        $2::jsonb,
        'atendimentos/teste.mp3', false, now(), 42, 'Rede credenciada'
      from agentes_voz
      where elevenlabs_agent_id = 'agent-livia-test'
      returning id
    `, [conversationId, JSON.stringify(transcricao)]);
    return result.rows[0]!.id;
  }

  test('transcrição longa no detalhe do Atendimento rola dentro do painel', async ({
    page
  }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-atendimento-transcricao-longa',
      longTranscript()
    );

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
    await expect(page.getByText('Transcrição', { exact: true })).toBeVisible();
    await expect.poll(async () => transcriptOverflows(transcriptScroll(page))).toBe(true);
  });

  test('transcrição curta no detalhe do Atendimento não ganha caixa vazia nem barra de rolagem', async ({
    page
  }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-atendimento-transcricao-curta',
      shortTranscript
    );

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
    await expect(page.getByText('Ola')).toBeVisible();
    const scroll = transcriptScroll(page);
    await expect.poll(async () => transcriptOverflows(scroll)).toBe(false);
    expect(await firstTurnFitsWithoutEmptyBox(scroll)).toBe(true);
  });

  test('player no detalhe do Atendimento controla áudio real, avança/retorna 30s e busca pela barra de progresso', async ({
    page
  }) => {
    const transcript = [
      { role: 'agent' as const, message: 'Olá! Sou a Lívia da GEAP.', time_in_call_secs: 0 },
      { role: 'user' as const, message: 'Preciso da segunda via do boleto.', time_in_call_secs: 15 },
      { role: 'agent' as const, message: 'Vou consultar o sistema para você.', time_in_call_secs: 35 },
      { role: 'user' as const, message: 'Muito obrigado pela ajuda.', time_in_call_secs: 55 }
    ];
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-atendimento-player-sync',
      transcript
    );

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    const player = page.getByTestId('audio-player');
    await expect(player).toBeVisible();
    const playBtn = page.getByRole('button', { name: 'Reproduzir áudio' });
    await expect(playBtn).toBeVisible();

    await playBtn.click();
    await expect(page.getByRole('button', { name: 'Pausar áudio' })).toBeVisible();
    await page.getByRole('button', { name: 'Pausar áudio' }).click();
    await expect(page.getByRole('button', { name: 'Reproduzir áudio' })).toBeVisible();

    const forwardBtn = page.getByRole('button', { name: 'Avançar 30 segundos' });
    await forwardBtn.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:30');
    await expect(page.getByTestId('transcript-turn-1')).toHaveClass(/active/);

    const backBtn = page.getByRole('button', { name: 'Voltar 30 segundos' });
    await backBtn.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:00');
    await expect(page.getByTestId('transcript-turn-0')).toHaveClass(/active/);

    const progressBar = page.getByTestId('audio-progress-bar');
    await progressBar.fill('35');
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:35');
    await expect(page.getByTestId('transcript-turn-2')).toHaveClass(/active/);
  });

  test('sincronia no detalhe: clique no turno faz seek, ferramentas sao exibidas legivelmente sem caixas vazias e scroll manual pausa auto-scroll', async ({
    page
  }) => {
    const transcript = [
      { role: 'agent' as const, message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
      { role: 'user' as const, message: 'Preciso de atendimento.', time_in_call_secs: 10 },
      {
        role: 'agent' as const,
        message:
          '[Chamada de Ferramenta: consultar_cadastro]\n[Resultado da Ferramenta: consultar_cadastro - Sucesso]',
        time_in_call_secs: 22
      },
      { role: 'agent' as const, message: 'Localizei seus dados no cadastro.', time_in_call_secs: 32 },
      { role: 'user' as const, message: 'Excelente.', time_in_call_secs: 42 },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'agent' : 'user') as 'agent' | 'user',
        message: `Turno adicional ${i + 5} de acompanhamento.`,
        time_in_call_secs: 50 + i * 5
      }))
    ];
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-atendimento-toolcall-sync',
      transcript
    );

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // Não deve renderizar caixas pontilhadas vazias
    await expect(page.locator('.transcript-empty-box')).toHaveCount(0);
    await expect(page.getByTestId('transcript-tool-call')).toHaveCount(0);

    // Mensagens descritivas de ferramentas são exibidas legivelmente
    await expect(page.getByText('[Chamada de Ferramenta: consultar_cadastro]')).toBeVisible();
    await expect(
      page.getByText('[Resultado da Ferramenta: consultar_cadastro - Sucesso]')
    ).toBeVisible();

    // Clique no turno de ferramenta move o player para o segundo exato
    const toolCallTurn = page.getByTestId('transcript-turn-2');
    await toolCallTurn.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:22');
    await expect(toolCallTurn).toHaveClass(/active/);

    // Clique em outro turno move o player para o segundo exato
    const turn3 = page.getByTestId('transcript-turn-3');
    await turn3.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:32');
    await expect(turn3).toHaveClass(/active/);

    // Scroll manual pausa o auto-scroll e exibe o botão "Voltar ao momento atual"
    const scroll = transcriptScroll(page);
    await scroll.hover();
    await page.mouse.wheel(0, 300);

    const resumeBtn = page.getByRole('button', { name: 'Voltar ao momento atual' });
    await expect(resumeBtn).toBeVisible();

    // Clicar em "Voltar ao momento atual" retoma o scroll e esconde o botão
    await resumeBtn.click();
    await expect(resumeBtn).toBeHidden();
    await expect(turn3).toHaveClass(/active/);
  });

  test('filtros de dia e motivo na tela de Atendimentos', async ({ page, request }) => {
    // Cria atendimentos com diferentes datas e motivos
    await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: 'conv-filtro-atend-1',
        contact_reason: 'Boleto/Pagamento',
        status: 'concluido',
        completed_at: '2026-08-10T14:00:00.000Z',
        duration_seconds: 120
      },
      headers: ingestionHeaders
    });
    await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: 'conv-filtro-atend-2',
        contact_reason: 'Rede Credenciada',
        status: 'concluido',
        completed_at: '2026-08-15T15:00:00.000Z',
        duration_seconds: 180
      },
      headers: ingestionHeaders
    });

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/atendimentos');

    // Filtro de dia único
    await page.locator('input[name="inicio"]').fill('2026-08-10');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/inicio=2026-08-10/);
    await expect(page.getByText('Boleto/Pagamento')).toBeVisible();

    // Filtro de motivo via combobox
    const motivoCombobox = page.locator('#atendimentos-motivo-filtro');
    await motivoCombobox.click();
    await motivoCombobox.fill('Rede Credenciada');
    await page.locator('input[name="inicio"]').fill('');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/motivo=Rede\+Credenciada|motivo=Rede%20Credenciada/);
    await expect(page.getByText('Rede Credenciada')).toBeVisible();

    // Limpar filtros
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL('/atendimentos');
  });

  test('filtros de curadoriaStatus, curadorId, endpoint /curadores e badge de curadoria nos cards', async ({
    page,
    request
  }) => {
    const admin = await login(request, 'admin');
    const curadorUser = authUsers.find((u) => u.role === 'curador')!;
    const curadorSession = await login(request, 'curador');
    const headers = { authorization: `Bearer ${admin.token}` };

    // 1. GET /curadores retorna lista com { id, nome }
    const curadoresResponse = await request.get(`${apiUrl}/curadores`, {
      headers
    });
    expect(curadoresResponse.status()).toBe(200);
    const curadores = (await curadoresResponse.json()) as Array<{
      id: string;
      nome: string;
    }>;
    expect(curadores.length).toBeGreaterThanOrEqual(1);
    const curador = curadores.find((c) => c.nome === curadorUser.name);
    expect(curador).toBeDefined();
    expect(curador?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Ingestão de 2 atendimentos para o teste
    const convRealizada = 'conv-curadoria-realizada-001';
    const convPendente = 'conv-curadoria-pendente-001';

    const resp1 = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: convRealizada,
        contact_reason: 'Curadoria Realizada Motivo',
        status: 'concluido',
        completed_at: '2026-08-18T10:00:00.000Z',
        duration_seconds: 150
      },
      headers: ingestionHeaders
    });
    expect(resp1.status()).toBe(201);
    const atend1 = (await resp1.json()) as { id: string };

    const resp2 = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        ...atendimento,
        conversation_id: convPendente,
        contact_reason: 'Curadoria Pendente Motivo',
        status: 'concluido',
        completed_at: '2026-08-18T11:00:00.000Z',
        duration_seconds: 120
      },
      headers: ingestionHeaders
    });
    expect(resp2.status()).toBe(201);
    const atend2 = (await resp2.json()) as { id: string };

    // Avaliação da IA para o primeiro atendimento
    await queryDatabase(
      `
      select * from persistir_avaliacao_ia(
        $1,
        (select id from prompts_ia_avaliadora where ativo),
        $2::jsonb,
        $3::jsonb,
        $4,
        $5,
        $6
      )
    `,
      [
        atend1.id,
        JSON.stringify(aprovada.checklist),
        JSON.stringify(aprovada.falhas_identificadas),
        aprovada.resumo_atendimento,
        aprovada.atendimento_aprovado,
        aprovada.nota_qualidade
      ]
    );

    // Salvar conferência do curador no primeiro atendimento
    const curadoriaDetailRes = await request.get(
      `${apiUrl}/curadoria/${atend1.id}`,
      { headers: { authorization: `Bearer ${curadorSession.token}` } }
    );
    expect(curadoriaDetailRes.status()).toBe(200);
    const curadoriaDetailData = (await curadoriaDetailRes.json()) as {
      avaliacaoIa: {
        checklist: Array<{ chave: string; estado: 'atendido' | 'nao_atendido' | 'nao_se_aplica' }>;
      };
    };

    const confRes = await request.post(
      `${apiUrl}/curadoria/${atend1.id}/avaliacoes`,
      {
        data: {
          checklist: curadoriaDetailData.avaliacaoIa.checklist.map((c) => ({
            chave: c.chave,
            estado: 'atendido'
          })),
          notaAvaliacaoIa: 9,
          falhasIdentificadas: [],
          resumoAtendimento: 'Atendimento revisado com sucesso',
          comentario: 'Curadoria aprovada sem ressalvas.'
        },
        headers: { authorization: `Bearer ${curadorSession.token}` }
      }
    );
    expect(confRes.status()).toBe(201);

    // 2. Consulta GET /atendimentos verifica metadados de curadoria
    const listRes = await request.get(`${apiUrl}/atendimentos`, { headers });
    expect(listRes.status()).toBe(200);
    const listData = (await listRes.json()) as {
      items: Array<{
        id: string;
        conversationId: string;
        curadoria: {
          realizada: boolean;
          curadorId: string | null;
          curadorNome: string | null;
          nota: number | null;
          realizadaEm: string | null;
        };
      }>;
    };

    const itemRealizada = listData.items.find(
      (item) => item.conversationId === convRealizada
    );
    expect(itemRealizada).toBeDefined();
    expect(itemRealizada?.curadoria).toMatchObject({
      realizada: true,
      curadorId: curador?.id,
      curadorNome: curadorUser.name,
      nota: expect.any(Number),
      realizadaEm: expect.any(String)
    });

    const itemPendente = listData.items.find(
      (item) => item.conversationId === convPendente
    );
    expect(itemPendente).toBeDefined();
    expect(itemPendente?.curadoria).toEqual({
      realizada: false,
      curadorId: null,
      curadorNome: null,
      nota: null,
      realizadaEm: null
    });

    // 3. Filtro por curadoriaStatus=realizada via API
    const listRealizada = await request.get(
      `${apiUrl}/atendimentos?curadoriaStatus=realizada`,
      { headers }
    );
    const dataRealizada = (await listRealizada.json()) as {
      items: Array<{ conversationId: string }>;
    };
    expect(
      dataRealizada.items.some((i) => i.conversationId === convRealizada)
    ).toBe(true);
    expect(
      dataRealizada.items.some((i) => i.conversationId === convPendente)
    ).toBe(false);

    // 4. Filtro por curadoriaStatus=pendente via API
    const listPendente = await request.get(
      `${apiUrl}/atendimentos?curadoriaStatus=pendente`,
      { headers }
    );
    const dataPendente = (await listPendente.json()) as {
      items: Array<{ conversationId: string }>;
    };
    expect(
      dataPendente.items.some((i) => i.conversationId === convRealizada)
    ).toBe(false);
    expect(
      dataPendente.items.some((i) => i.conversationId === convPendente)
    ).toBe(true);

    // 5. Filtro por curadorId via API
    const listCurador = await request.get(
      `${apiUrl}/atendimentos?curadorId=${curador?.id}`,
      { headers }
    );
    const dataCurador = (await listCurador.json()) as {
      items: Array<{ conversationId: string }>;
    };
    expect(
      dataCurador.items.some((i) => i.conversationId === convRealizada)
    ).toBe(true);
    expect(
      dataCurador.items.some((i) => i.conversationId === convPendente)
    ).toBe(false);

    // 6. Teste da interface AtendimentosPage (filtros e badges)
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/atendimentos');

    // Verificar exibição dos badges nos cards
    await expect(
      page.getByText(`Curadoria: ${curadorUser.name}`).first()
    ).toBeVisible();
    await expect(page.getByText('Curadoria pendente').first()).toBeVisible();

    // Filtrar por Status da Curadoria = Realizada
    await page
      .locator('#atendimentos-curadoria-status-filtro')
      .selectOption('realizada');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/curadoriaStatus=realizada/);
    await expect(
      page.getByText('Curadoria Realizada Motivo').first()
    ).toBeVisible();
    await expect(
      page.getByText('Curadoria Pendente Motivo')
    ).not.toBeVisible();

    // Filtrar por Curador
    await page
      .locator('#atendimentos-curadoria-status-filtro')
      .selectOption('');
    await page
      .locator('#atendimentos-curador-filtro')
      .selectOption(curador!.id);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(new RegExp(`curadorId=${curador!.id}`));
    await expect(
      page.getByText('Curadoria Realizada Motivo').first()
    ).toBeVisible();
    await expect(
      page.getByText('Curadoria Pendente Motivo')
    ).not.toBeVisible();

    // Limpar filtros
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL('/atendimentos');
  });
});
