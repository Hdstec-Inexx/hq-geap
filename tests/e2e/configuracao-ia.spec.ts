import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';
import { authUsers } from '../support/auth-fixtures.js';

const apiUrl = 'http://127.0.0.1:3000';
const { Client } = pg;

async function login(request: APIRequestContext, role: 'admin' | 'gestao') {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { token: string };
}

test.describe.serial('configuracao versionada da IA Avaliadora', () => {
  test('somente Admin consulta e publica uma nova versao atomica', async ({
    request
  }) => {
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');
    const adminHeaders = { authorization: `Bearer ${admin.token}` };

    const forbiddenRead = await request.get(`${apiUrl}/admin/configuracao-ia`, {
      headers: { authorization: `Bearer ${gestao.token}` }
    });
    const forbiddenPublication = await request.post(
      `${apiUrl}/admin/configuracao-ia`,
      {
        data: {
          prompt: 'Tentativa sem permissao',
          provider: 'openrouter',
          model: 'google/gemini-2.5-flash',
          temperature: 0
        },
        headers: { authorization: `Bearer ${gestao.token}` }
      }
    );
    const currentResponse = await request.get(`${apiUrl}/admin/configuracao-ia`, {
      headers: adminHeaders
    });

    expect(forbiddenRead.status()).toBe(403);
    expect(forbiddenPublication.status()).toBe(403);
    expect(currentResponse.status()).toBe(200);
    const current = await currentResponse.json();
    expect(current).toMatchObject({
      active: true,
      provider: 'openrouter',
      model: expect.any(String),
      prompt: expect.any(String),
      temperature: expect.any(Number),
      version: expect.any(Number)
    });

    const publication = {
      prompt: 'Avalie o Atendimento conforme a Regua de Avaliacao vigente.',
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash',
      temperature: 0.2
    };
    const publishResponse = await request.post(
      `${apiUrl}/admin/configuracao-ia`,
      { data: publication, headers: adminHeaders }
    );

    expect(publishResponse.status()).toBe(201);
    await expect(publishResponse.json()).resolves.toMatchObject({
      ...publication,
      active: true,
      version: current.version + 1
    });

    const client = new Client({
      connectionString:
        process.env.TEST_DATABASE_URL ??
        'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test'
    });
    await client.connect();
    try {
      const rows = await client.query<{
        ativo: boolean;
        modelo: string;
        prompt: string;
        provedor: string;
        temperatura: string;
        versao: number;
      }>(`
        select versao, prompt, provedor, modelo, temperatura, ativo
        from prompts_ia_avaliadora
        where versao in ($1, $2)
        order by versao
      `, [current.version, current.version + 1]);

      expect(rows.rows).toEqual([
        expect.objectContaining({
          ativo: false,
          modelo: current.model,
          prompt: current.prompt,
          provedor: current.provider,
          versao: current.version
        }),
        expect.objectContaining({
          ativo: true,
          modelo: publication.model,
          prompt: publication.prompt,
          provedor: publication.provider,
          temperatura: '0.2',
          versao: current.version + 1
        })
      ]);
      const activeCount = await client.query<{ count: string }>(
        'select count(*) from prompts_ia_avaliadora where ativo'
      );
      expect(activeCount.rows[0]?.count).toBe('1');

      await expect(
        client.query(
          'update prompts_ia_avaliadora set modelo = $1 where versao = $2',
          ['modelo-adulterado', current.version]
        )
      ).rejects.toThrow(/immutable/i);

      const agent = await client.query<{ id: string }>(`
        insert into agentes_voz (nome, elevenlabs_agent_id)
        values ('Agente para teste', 'agent-config-test')
        returning id
      `);
      const atendimento = await client.query<{ id: string }>(`
        insert into atendimentos (agente_voz_id, elevenlabs_conversation_id, status)
        values ($1, 'conversation-config-test', 'concluido')
        returning id
      `, [agent.rows[0]!.id]);
      await expect(
        client.query(
          `insert into avaliacoes (
             atendimento_id, autor, nota,
             saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
             resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
             encerramento_geap, atendimento_aprovado, nota_qualidade
           )
           values (
             $1, 'ia', 0,
             true, true, true, true, true, true, true, false, 0
           )`,
          [atendimento.rows[0]!.id]
        )
      ).rejects.toThrow(/avaliacoes_ia_exigem_prompt/i);
    } finally {
      await client.end();
    }
  });

  test('publicacoes concorrentes preservam uma unica versao ativa', async ({
    request
  }) => {
    const admin = await login(request, 'admin');
    const headers = { authorization: `Bearer ${admin.token}` };
    const currentResponse = await request.get(`${apiUrl}/admin/configuracao-ia`, {
      headers
    });
    const current = await currentResponse.json();

    const responses = await Promise.all(
      ['google/gemini-2.5-flash', 'google/gemini-2.5-pro'].map((model) =>
        request.post(`${apiUrl}/admin/configuracao-ia`, {
          data: {
            prompt: `Configuracao concorrente para ${model}.`,
            provider: 'openrouter',
            model,
            temperature: 0.1
          },
          headers
        })
      )
    );

    expect(responses.map((response) => response.status())).toEqual([201, 201]);
    const publications = await Promise.all(
      responses.map((response) => response.json())
    );
    expect(publications.map(({ version }) => version).sort((a, b) => a - b)).toEqual([
      current.version + 1,
      current.version + 2
    ]);

    const client = new Client({
      connectionString:
        process.env.TEST_DATABASE_URL ??
        'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test'
    });
    await client.connect();
    try {
      const active = await client.query<{ count: string; version: number }>(`
        select count(*) as count, max(versao) as version
        from prompts_ia_avaliadora
        where ativo
      `);
      expect(active.rows[0]).toEqual({
        count: '1',
        version: current.version + 2
      });
    } finally {
      await client.end();
    }
  });

  test('Admin consulta e publica pela interface administrativa', async ({
    page
  }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('link', { name: 'Configurar IA Avaliadora' }).click();

    await expect(
      page.getByRole('heading', { name: 'Configuração da IA Avaliadora' })
    ).toBeVisible();
    await expect(page.getByText(/Versão ativa \d+/)).toBeVisible();

    await page.getByLabel('Prompt').fill('Novo prompt publicado pela interface.');
    await page.getByLabel('Provedor').fill('openrouter');
    await page.getByLabel('Modelo').fill('google/gemini-2.5-pro');
    await page.getByLabel('Temperatura').fill('0.3');
    await page.getByRole('button', { name: 'Publicar nova versão' }).click();

    await expect(page.getByRole('status')).toContainText('Nova versão publicada');
    await expect(page.getByText('google/gemini-2.5-pro')).toBeVisible();
  });
});
