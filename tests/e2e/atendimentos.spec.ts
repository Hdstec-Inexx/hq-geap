import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';
import fixture from '../fixtures/elevenlabs/atendimento-concluido.json' with { type: 'json' };
import { authUsers } from '../support/auth-fixtures.js';

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

  test('cria pelo conversation_id e ignora o reenvio sem duplicar', async ({
    request
  }) => {
    const first = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: atendimento,
      headers: ingestionHeaders
    });
    expect(first.status()).toBe(201);
    const created = await first.json();

    const replay = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: { ...atendimento, contact_reason: 'Segunda via de boleto' },
      headers: ingestionHeaders
    });
    expect(replay.status()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      id: created.id,
      conversationId: atendimento.conversation_id,
      motivoContato: atendimento.contact_reason,
      status: 'concluido'
    });

    const persisted = await queryDatabase<{
      agente_voz_id: string;
      count: string;
    }>(`
      select count(*)::text as count, min(agente_voz_id::text) as agente_voz_id
      from atendimentos
      where elevenlabs_conversation_id = $1
      group by elevenlabs_conversation_id
    `, [atendimento.conversation_id]);
    const agent = await queryDatabase<{ id: string }>(
      'select id from agentes_voz where elevenlabs_agent_id = $1',
      [atendimento.agent_id]
    );
    expect(persisted.rows[0]).toEqual({
      agente_voz_id: agent.rows[0]?.id,
      count: '1'
    });
  });

  test('permite em andamento para concluido e impede regressao', async ({
    request
  }) => {
    const conversationId = 'conv-lifecycle-001';
    const inProgress = await request.post(`${apiUrl}/atendimentos/ingestao`, {
      data: {
        conversation_id: conversationId,
        agent_id: atendimento.agent_id,
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
    const list = (await listResponse.json()) as Array<Record<string, unknown>>;
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

    const id = summary?.id as string;
    for (const session of [admin, gestao]) {
      const response = await request.get(`${apiUrl}/atendimentos/${id}`, {
        headers: headersFor(session.token)
      });
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        audioUrl: atendimento.audio_url,
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
    await page.getByRole('link', { name: /Financeiro\/Boletos/ }).click();
    await expect(page.getByRole('heading', { name: /Atendimento/ })).toBeVisible();
    await expect(page.getByText('Financeiro/Boletos')).toBeVisible();
    await expect(page.getByText('R$ 0,18')).toBeVisible();
    await expect(page.getByText(/Preciso da segunda via do boleto/)).toBeVisible();
  });
});
