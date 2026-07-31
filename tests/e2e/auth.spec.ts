import { expect, test } from '@playwright/test';
import { buildApp } from '../../apps/api/src/app.js';
import { authUsers } from '../support/auth-fixtures.js';

const apiUrl = 'http://127.0.0.1:3000';

let policyApp: Awaited<ReturnType<typeof buildApp>>;
let policyUrl: string;

test.beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';
  process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-chars';

  policyApp = await buildApp();
  policyApp.get(
    '/test/admin-only',
    { config: { auth: { roles: ['admin'] } } },
    async () => ({ allowed: true })
  );
  policyApp.get(
    '/test/curador-area',
    { config: { auth: { roles: ['curador'] } } },
    async () => ({ allowed: true })
  );
  policyApp.post('/test/write', async () => ({ written: true }));
  policyApp.get('/test/atendimento', async () => ({
    id: 'atendimento-1',
    custo: '1.2500',
    avaliacao: { nota: 8, custo: 'internal-cost' }
  }));
  policyUrl = await policyApp.listen({ host: '127.0.0.1', port: 0 });
});

test.afterAll(async () => {
  await policyApp.close();
});

async function tokenFor(email: string, password: string) {
  const response = await fetch(`${policyUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

for (const fixture of authUsers) {
  test(`${fixture.role} autentica com credenciais validas`, async ({
    request
  }) => {
    const loginResponse = await request.post(`${apiUrl}/auth/login`, {
      data: { email: fixture.email, password: fixture.password }
    });

    expect(loginResponse.status()).toBe(200);
    const login = await loginResponse.json();
    expect(login).toMatchObject({
      token: expect.any(String),
      user: {
        id: expect.any(String),
        email: fixture.email,
        name: fixture.name,
        role: fixture.role
      }
    });

    const sessionResponse = await request.get(`${apiUrl}/auth/session`, {
      headers: { authorization: `Bearer ${login.token}` }
    });

    expect(sessionResponse.status()).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual(login.user);
  });
}

test('credenciais invalidas nao iniciam sessao', async ({ request }) => {
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: 'admin@hq.test', password: 'senha-incorreta' }
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    message: 'Invalid email or password'
  });
});

test('rota protegida rejeita usuario anonimo', async ({ request }) => {
  const response = await request.get(`${apiUrl}/auth/session`);

  expect(response.status()).toBe(401);
});

test('papel sem permissao recebe 403', async () => {
  const token = await tokenFor('curador@hq.test', 'senha-curador');
  const response = await fetch(`${policyUrl}/test/admin-only`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` }
  });

  expect(response.status).toBe(403);
});

test('Admin herda o acesso dos demais papeis', async () => {
  const token = await tokenFor('admin@hq.test', 'senha-admin');
  const response = await fetch(`${policyUrl}/test/curador-area`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` }
  });

  expect(response.status).toBe(200);
});

test('Gestao pode ler, mas nao pode escrever', async () => {
  const token = await tokenFor('gestao@hq.test', 'senha-gestao');
  const readResponse = await fetch(`${policyUrl}/test/atendimento`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` }
  });
  const writeResponse = await fetch(`${policyUrl}/test/write`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });

  expect(readResponse.status).toBe(200);
  expect(writeResponse.status).toBe(403);
});

test('respostas para Curador omitem Custo em qualquer nivel', async () => {
  const curadorToken = await tokenFor('curador@hq.test', 'senha-curador');
  const gestaoToken = await tokenFor('gestao@hq.test', 'senha-gestao');

  const curadorResponse = await fetch(`${policyUrl}/test/atendimento`, {
    method: 'GET',
    headers: { authorization: `Bearer ${curadorToken}` }
  });
  const gestaoResponse = await fetch(`${policyUrl}/test/atendimento`, {
    method: 'GET',
    headers: { authorization: `Bearer ${gestaoToken}` }
  });

  await expect(curadorResponse.json()).resolves.toEqual({
    id: 'atendimento-1',
    avaliacao: { nota: 8 }
  });
  await expect(gestaoResponse.json()).resolves.toMatchObject({
    custo: '1.2500'
  });
});

test('rota do app rejeita papel sem permissao', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('curador@hq.test');
  await page.getByLabel('Senha').fill('senha-curador');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Olá, Caio Curador' })
  ).toBeVisible();

  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Acesso não autorizado' })
  ).toBeVisible();
});

test('login pela interface restaura a sessao e permite sair', async ({
  page
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Acesse o HQ GEAP' })
  ).toBeVisible();

  await page.getByLabel('E-mail').fill('admin@hq.test');
  await page.getByLabel('Senha').fill('senha-admin');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(
    page.getByRole('heading', { name: 'Olá, Ana Admin' })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Olá, Ana Admin' })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(
    page.getByRole('heading', { name: 'Acesse o HQ GEAP' })
  ).toBeVisible();
});

test('login pela interface orienta sobre credenciais invalidas', async ({
  page
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@hq.test');
  await page.getByLabel('Senha').fill('senha-incorreta');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'E-mail ou senha inválidos. Verifique os dados e tente novamente.'
  );
});
