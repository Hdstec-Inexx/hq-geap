import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';
import aprovada from '../fixtures/avaliacoes/avaliacao-aprovada.json' with { type: 'json' };
import { authUsers } from '../support/auth-fixtures.js';

const apiUrl = 'http://127.0.0.1:3000';
const { Client } = pg;

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

async function login(
  request: APIRequestContext,
  role: 'admin' | 'gestao' | 'curador'
) {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  return (await response.json()) as { token: string };
}

async function createAtendimento(conversationId: string) {
  const result = await queryDatabase<{ id: string }>(`
    insert into atendimentos (
      agente_voz_id, elevenlabs_conversation_id, status, transcricao,
      houve_transferencia, concluido_em
    )
    select id, $1, 'concluido', '[]'::jsonb, false, now()
    from agentes_voz
    where elevenlabs_agent_id = 'agent-livia-comentarios'
    returning id
  `, [conversationId]);
  return result.rows[0]!.id;
}

async function persistirAvaliacaoIa(atendimentoId: string) {
  await queryDatabase(`
    select * from persistir_avaliacao_ia(
      $1,
      (select id from prompts_ia_avaliadora where ativo),
      $2::jsonb,
      '[]'::jsonb,
      'Atendimento com comentario.'
    )
  `, [atendimentoId, JSON.stringify(aprovada.checklist)]);
}

test.describe.serial('Comentarios e fila de manutencao', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Livia', 'agent-livia-comentarios')
      on conflict (elevenlabs_agent_id) do nothing
    `);
  });

  test('Curador e Admin criam Comentarios e Gestao apenas consulta', async ({
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-comentarios-papeis');
    const curador = await login(request, 'curador');
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');

    const criadoPeloCurador = await request.post(
      `${apiUrl}/atendimentos/${atendimentoId}/comentarios`,
      {
        headers: { authorization: `Bearer ${curador.token}` },
        data: { texto: 'Ajustar a resposta sobre rede credenciada.' }
      }
    );
    expect(criadoPeloCurador.status()).toBe(201);
    await expect(criadoPeloCurador.json()).resolves.toMatchObject({
      texto: 'Ajustar a resposta sobre rede credenciada.',
      status: 'pendente',
      autor: { nome: 'Caio Curador' },
      resolucao: null
    });

    const criadoPeloAdmin = await request.post(
      `${apiUrl}/atendimentos/${atendimentoId}/comentarios`,
      {
        headers: { authorization: `Bearer ${admin.token}` },
        data: { texto: 'Revisar também a saudação inicial.' }
      }
    );
    expect(criadoPeloAdmin.status()).toBe(201);

    const leitura = await request.get(
      `${apiUrl}/atendimentos/${atendimentoId}/comentarios`,
      { headers: { authorization: `Bearer ${gestao.token}` } }
    );
    expect(leitura.status()).toBe(200);
    expect(await leitura.json()).toHaveLength(2);

    const proibido = await request.post(
      `${apiUrl}/atendimentos/${atendimentoId}/comentarios`,
      {
        headers: { authorization: `Bearer ${gestao.token}` },
        data: { texto: 'Gestao nao pode escrever.' }
      }
    );
    expect(proibido.status()).toBe(403);
  });

  test('somente Admin resolve e a fila pode ser filtrada por status', async ({
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-comentarios-resolucao');
    const curador = await login(request, 'curador');
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');
    const created = await request.post(
      `${apiUrl}/atendimentos/${atendimentoId}/comentarios`,
      {
        headers: { authorization: `Bearer ${curador.token}` },
        data: { texto: 'Corrigir a orientação do agente.' }
      }
    );
    const comentario = (await created.json()) as { id: string };

    const gestaoForbidden = await request.patch(
      `${apiUrl}/comentarios/${comentario.id}`,
      {
        headers: { authorization: `Bearer ${gestao.token}` },
        data: { status: 'resolvido' }
      }
    );
    expect(gestaoForbidden.status()).toBe(403);
    const curadorForbidden = await request.patch(
      `${apiUrl}/comentarios/${comentario.id}`,
      {
        headers: { authorization: `Bearer ${curador.token}` },
        data: { status: 'resolvido' }
      }
    );
    expect(curadorForbidden.status()).toBe(403);

    const resolved = await request.patch(
      `${apiUrl}/comentarios/${comentario.id}`,
      {
        headers: { authorization: `Bearer ${admin.token}` },
        data: { status: 'resolvido' }
      }
    );
    expect(resolved.status()).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      id: comentario.id,
      status: 'resolvido',
      resolucao: { responsavel: { nome: 'Alice Admin' } }
    });

    const persisted = await queryDatabase<{
      status: string;
      resolvidoPor: string | null;
      resolvidoEm: Date | null;
    }>(`
      select status, resolvido_por as "resolvidoPor", resolvido_em as "resolvidoEm"
      from comentarios where id = $1
    `, [comentario.id]);
    expect(persisted.rows[0]).toMatchObject({
      status: 'resolvido',
      resolvidoPor: expect.any(String),
      resolvidoEm: expect.any(Date)
    });

    const pending = await request.get(`${apiUrl}/comentarios?status=pendente`, {
      headers: { authorization: `Bearer ${admin.token}` }
    });
    expect(pending.status()).toBe(200);
    expect(
      ((await pending.json()) as Array<{ id: string }>).map(({ id }) => id)
    ).not.toContain(comentario.id);

    const resolvedQueue = await request.get(
      `${apiUrl}/comentarios?status=resolvido`,
      { headers: { authorization: `Bearer ${admin.token}` } }
    );
    expect(resolvedQueue.status()).toBe(200);
    expect(
      ((await resolvedQueue.json()) as Array<{ id: string }>).map(({ id }) => id)
    ).toContain(comentario.id);
  });

  test('Comentarios aparecem no detalhe e na revisao do Curador', async ({
    page,
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-comentarios-interface');
    await persistirAvaliacaoIa(atendimentoId);
    const admin = await login(request, 'admin');
    await request.post(`${apiUrl}/atendimentos/${atendimentoId}/comentarios`, {
      headers: { authorization: `Bearer ${admin.token}` },
      data: { texto: 'Comentário visível nas duas telas.' }
    });

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await page.goto(`/atendimentos/${atendimentoId}`);
    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();
    await expect(page.getByText('Comentário visível nas duas telas.')).toBeVisible();

    await page.goto(`/curadoria/${atendimentoId}`);
    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();
    await expect(page.getByText('Comentário visível nas duas telas.')).toBeVisible();
  });

  test('Admin filtra e resolve a fila pela interface', async ({ page, request }) => {
    const atendimentoId = await createAtendimento('conv-comentarios-admin-ui');
    const curador = await login(request, 'curador');
    await request.post(`${apiUrl}/atendimentos/${atendimentoId}/comentarios`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: { texto: 'Item pendente para a fila administrativa.' }
    });

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.goto('/admin/comentarios');

    await expect(page.getByRole('heading', { name: 'Fila de manutenção' })).toBeVisible();
    await expect(page.getByText('Item pendente para a fila administrativa.')).toBeVisible();
    await page.getByRole('button', { name: 'Marcar como resolvido' }).click();
    await expect(page.getByText('Item pendente para a fila administrativa.')).toHaveCount(0);

    await page.getByLabel('Status').selectOption('resolvido');
    await expect(page.getByText('Item pendente para a fila administrativa.')).toBeVisible();
  });
});
