import { expect, test, type Page } from '@playwright/test';
import {
  authUserFor,
  loginApi,
  loginPage,
  type AuthRole
} from '../support/e2e-auth.js';

const apiUrl = 'http://127.0.0.1:3000';

const areasPorPapel: Record<AuthRole, string[]> = {
  curador: [
    'Consultar Atendimentos',
    'Monitoramento ao Vivo',
    'Abrir Fila de Curadoria'
  ],
  gestao: [
    'Abrir Dashboard da Gestão',
    'Consultar Atendimentos',
    'Monitoramento ao Vivo',
    'Consultar Fila de Curadoria'
  ],
  admin: [
    'Abrir Dashboard da Gestão',
    'Consultar Atendimentos',
    'Monitoramento ao Vivo',
    'Abrir Fila de Curadoria',
    'Trabalhar fila de manutenção',
    'Administrar usuários',
    'Configurar IA Avaliadora',
    'Consultar Régua de Avaliação'
  ]
};

const todosOsDestinos = [
  ...new Set(Object.values(areasPorPapel).flat())
];

function cascaNav(page: Page) {
  return page.getByRole('navigation', { name: 'Áreas do HQ GEAP' });
}

function cascaChrome(page: Page) {
  return page.getByRole('complementary', { name: 'Navegação principal' });
}

async function expectNoCasca(page: Page) {
  await expect(cascaNav(page)).toHaveCount(0);
  await expect(cascaChrome(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'GEAP, início' })).toHaveCount(0);
  for (const label of todosOsDestinos) {
    await expect(page.getByRole('link', { name: label })).toHaveCount(0);
  }
  await expect(page.getByText('Ambiente local')).toHaveCount(0);
}

async function expectFavicon(page: Page) {
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    'href',
    '/favicon.ico'
  );
}

async function expectAreasForRole(page: Page, role: AuthRole) {
  const nav = cascaNav(page);
  await expect(nav).toBeVisible();

  const expected = areasPorPapel[role];
  await expect(nav.getByRole('link')).toHaveCount(expected.length);

  for (const label of expected) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
}

async function refreshPerfilOnFocus(page: Page) {
  await page.waitForFunction(() => {
    const raw = window.sessionStorage.getItem('hq-geap.last-me-at');
    if (!raw) return true;
    return Date.now() - Number(raw) >= 2100;
  });
  const perfilGet = page.waitForResponse(
    (response) =>
      response.url().includes('/me') &&
      response.request().method() === 'GET' &&
      response.ok(),
    { timeout: 15_000 }
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await perfilGet;
}

test.describe('casca autenticada', () => {
  test('login e health ficam sem navegação de áreas da casca', async ({
    page
  }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('heading', { name: 'Acesse o HQ GEAP' })
    ).toBeVisible();
    await expectNoCasca(page);
    await expectFavicon(page);

    await page.goto('/health');
    await expect(
      page.getByRole('heading', { name: 'HQ GEAP está operacional' })
    ).toBeVisible();
    await expectNoCasca(page);
  });

  for (const role of ['curador', 'gestao', 'admin'] as const) {
    test(`autenticado como ${role} vê só as áreas do papel na casca`, async ({
      page
    }) => {
      const user = authUserFor(role);
      await loginPage(page, role);

      await expect(cascaChrome(page)).toBeVisible();
      await expect(cascaChrome(page).getByText(user.name, { exact: true })).toBeVisible();
      await expect(cascaChrome(page).getByRole('button', { name: 'Sair' })).toBeVisible();
      await expectAreasForRole(page, role);
      await expect(page.getByText('Ambiente local')).toHaveCount(0);
      await expectFavicon(page);
    });
  }

  test('marca GEAP leva à Home; nome fica na casca; Sair encerra a sessão', async ({
    page
  }) => {
    const user = authUserFor('admin');
    await loginPage(page, 'admin');

    await page.getByRole('link', { name: 'Consultar Atendimentos' }).click();
    await expect(page).toHaveURL('/atendimentos');

    await page.getByRole('link', { name: 'GEAP, início' }).click();
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: `Olá, ${user.name}` })
    ).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();
    await expect(cascaChrome(page).getByText(user.name, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL('/login');
    await expect(
      page.getByRole('heading', { name: 'Acesse o HQ GEAP' })
    ).toBeVisible();
    await expectNoCasca(page);
  });

  test('após demotion de papel, destinos Admin somem da casca', async ({
    page,
    request
  }) => {
    const admin = await loginApi(request, 'admin');
    const headers = { authorization: `Bearer ${admin.token}` };
    const targetEmail = `casca-demote-${Date.now()}@hq.test`;
    const created = await request.post(`${apiUrl}/admin/usuarios`, {
      data: {
        email: targetEmail,
        name: 'Admin casca demote',
        password: 'senha-segura',
        role: 'admin'
      },
      headers
    });
    expect(created.status()).toBe(201);
    const target = (await created.json()) as { id: string };

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(targetEmail);
    await page.getByLabel('Senha').fill('senha-segura');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await expectAreasForRole(page, 'admin');

    const demotion = await request.patch(
      `${apiUrl}/admin/usuarios/${target.id}`,
      {
        data: {
          email: targetEmail,
          name: 'Admin casca demote',
          role: 'gestao'
        },
        headers
      }
    );
    expect(demotion.status()).toBe(200);

    await refreshPerfilOnFocus(page);
    await expect(
      cascaNav(page).getByRole('link', { name: 'Administrar usuários' })
    ).toHaveCount(0);
    await expectAreasForRole(page, 'gestao');
  });
});
