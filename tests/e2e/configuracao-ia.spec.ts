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
      expect(rows.rows.filter((row) => row.ativo)).toHaveLength(1);

      await expect(
        client.query(
          'update prompts_ia_avaliadora set modelo = $1 where versao = $2',
          ['modelo-adulterado', current.version],
        )
      ).rejects.toThrow(/immutable/i);
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
