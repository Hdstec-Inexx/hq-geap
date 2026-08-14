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
        transcricao: atendimento.transcript
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
});
