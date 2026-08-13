import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  abrirFaixaDeNavegacao,
  fecharFaixaDeNavegacao
} from '../../apps/web/src/app/casca-faixa.js';
import {
  authUserFor,
  loginApi,
  loginPage,
  type AuthRole
} from '../support/e2e-auth.js';

const marcaTetoPx = 168;
const marcaAlvoMaxPx = 100;
const conteudoComFaixaMinLeftPx = 200;
const conteudoSemFaixaMaxLeftPx = 80;
const faixaEstreitaMinShiftPx = 40;
const marcaFundoTransparente = 'rgba(0, 0, 0, 0)';
const toggleMaxWidthPx = 200;

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

function fecharFaixa(page: Page) {
  return page.getByRole('button', { name: fecharFaixaDeNavegacao });
}

function abrirFaixa(page: Page) {
  return page.getByRole('button', { name: abrirFaixaDeNavegacao });
}

async function markMountProbe(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const token = `mount-${Date.now()}`;
    el.setAttribute('data-mount-probe', token);
    return token;
  });
}

async function visibleBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('elemento visível sem caixa de layout');
  }
  return box;
}

async function expectNoCasca(page: Page) {
  await expect(cascaNav(page)).toHaveCount(0);
  await expect(cascaChrome(page)).toHaveCount(0);
  await expect(fecharFaixa(page)).toHaveCount(0);
  await expect(abrirFaixa(page)).toHaveCount(0);
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

async function waitFocusRefreshGap(page: Page) {
  await page.waitForFunction(() => {
    const raw = window.sessionStorage.getItem('hq-geap.last-me-at');
    if (!raw) return true;
    return Date.now() - Number(raw) >= 2100;
  });
}

async function refreshPerfilOnFocus(page: Page) {
  await waitFocusRefreshGap(page);
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

async function refreshRevokedPerfilOnFocus(page: Page) {
  await waitFocusRefreshGap(page);
  const perfilGet = page.waitForResponse(
    (response) =>
      response.url().includes('/me') &&
      response.request().method() === 'GET' &&
      [401, 403].includes(response.status()),
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
      await expect(page.getByRole('link', { name: 'GEAP, início' })).toBeVisible();
      await expect(fecharFaixa(page)).toHaveAttribute('aria-expanded', 'true');
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

    const marca = page.getByRole('link', { name: 'GEAP, início' });
    const logo = marca.locator('img');
    await expect(logo).toHaveAttribute('src', '/geap_saude_transparente.png');
    const logoBox = await visibleBox(logo);
    expect(logoBox.width).toBeLessThan(marcaTetoPx);
    expect(logoBox.width).toBeLessThanOrEqual(marcaAlvoMaxPx);
    await expect
      .poll(async () =>
        marca.evaluate((el) => getComputedStyle(el).backgroundColor)
      )
      .toBe(marcaFundoTransparente);

    await fecharFaixa(page).focus();
    await expect(fecharFaixa(page)).toBeFocused();
    await marca.focus();
    await expect(marca).toBeFocused();

    await marca.click();
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

  test('rota nested mantém a casca e marca a área atual', async ({ page }) => {
    await loginPage(page, 'curador');
    await page.goto('/atendimentos/00000000-4000-8000-0000-000000000001');

    await expect(cascaChrome(page)).toBeVisible();
    await expect(
      cascaNav(page).getByRole('link', { name: 'Consultar Atendimentos' })
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      cascaNav(page).getByRole('link', { name: 'Monitoramento ao Vivo' })
    ).not.toHaveAttribute('aria-current');
    await expect(cascaChrome(page).getByRole('button', { name: 'Sair' })).toBeVisible();
  });

  test('viewport estreito mantém áreas, nome e Sair ao alcance', async ({
    page
  }) => {
    const user = authUserFor('admin');
    await page.setViewportSize({ width: 390, height: 844 });
    await loginPage(page, 'admin');

    await expect(cascaChrome(page)).toBeVisible();
    await expect(cascaChrome(page).getByText(user.name, { exact: true })).toBeVisible();
    await expect(cascaChrome(page).getByRole('button', { name: 'Sair' })).toBeVisible();
    await expectAreasForRole(page, 'admin');

    await cascaNav(page)
      .getByRole('link', { name: 'Consultar Atendimentos' })
      .click();
    await expect(page).toHaveURL('/atendimentos');
    await expect(cascaChrome(page)).toBeInViewport();
  });

  test('casca permanece visível depois de rolar uma área longa', async ({
    page
  }) => {
    await loginPage(page, 'admin');
    await page.getByRole('link', { name: 'Abrir Dashboard da Gestão' }).click();
    await expect(
      page.getByRole('heading', { name: 'Pulso da operação' })
    ).toBeVisible();

    await page.evaluate(() => {
      const heading = document.querySelector('h1');
      const pageRoot = heading?.closest('section') ?? heading?.parentElement;
      if (!pageRoot) {
        throw new Error('área autenticada não encontrada');
      }
      const spacer = document.createElement('div');
      spacer.style.height = '4000px';
      spacer.setAttribute('aria-hidden', 'true');
      pageRoot.appendChild(spacer);
      window.scrollTo(0, 1600);
    });
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await expect(cascaChrome(page)).toBeInViewport();
    await expect(cascaChrome(page).getByRole('button', { name: 'Sair' })).toBeVisible();

    await fecharFaixa(page).click();
    await expect(abrirFaixa(page)).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 2400));
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await expect(abrirFaixa(page)).toBeInViewport();
  });

  test('sessão inválida leva ao login e remove a casca', async ({
    page,
    request
  }) => {
    const admin = await loginApi(request, 'admin');
    const headers = { authorization: `Bearer ${admin.token}` };
    const targetEmail = `casca-revoke-${Date.now()}@hq.test`;
    const created = await request.post(`${apiUrl}/admin/usuarios`, {
      data: {
        email: targetEmail,
        name: 'Admin casca revoke',
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
    await expect(cascaChrome(page)).toBeVisible();
    await fecharFaixa(page).click();
    await expect(abrirFaixa(page)).toBeVisible();

    const deactivation = await request.post(
      `${apiUrl}/admin/usuarios/${target.id}/desativar`,
      { headers }
    );
    expect(deactivation.status()).toBe(200);

    await refreshRevokedPerfilOnFocus(page);
    await expect(page).toHaveURL('/login');
    await expect(
      page.getByRole('heading', { name: 'Acesse o HQ GEAP' })
    ).toBeVisible();
    await expectNoCasca(page);
  });

  test('fecha e reabre a faixa sem remount, logout ou mudança de áreas', async ({
    page
  }) => {
    const user = authUserFor('admin');
    await loginPage(page, 'admin');
    await page.getByRole('link', { name: 'Consultar Atendimentos' }).click();
    await expect(page).toHaveURL('/atendimentos');

    const heading = page.getByRole('heading', { name: 'Atendimentos' });
    await expect(heading).toBeVisible();
    const probe = await markMountProbe(heading);

    await expect(fecharFaixa(page)).toHaveAttribute('aria-expanded', 'true');
    await fecharFaixa(page).click();

    await expect(abrirFaixa(page)).toBeVisible();
    await expect(abrirFaixa(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(abrirFaixa(page)).toBeInViewport();
    const toggleBox = await visibleBox(abrirFaixa(page));
    expect(toggleBox.width).toBeLessThan(toggleMaxWidthPx);
    await expect(cascaNav(page)).toHaveCount(0);
    await expect(cascaChrome(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'GEAP, início' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);
    await expect(page).toHaveURL('/atendimentos');
    await expect(heading).toHaveAttribute('data-mount-probe', probe);

    await refreshPerfilOnFocus(page);
    await expect(abrirFaixa(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(heading).toHaveAttribute('data-mount-probe', probe);

    await abrirFaixa(page).click();
    await expect(fecharFaixa(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(cascaChrome(page)).toBeVisible();
    await expect(cascaChrome(page).getByText(user.name, { exact: true })).toBeVisible();
    await expect(cascaChrome(page).getByRole('button', { name: 'Sair' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GEAP, início' })).toBeVisible();
    await expectAreasForRole(page, 'admin');
    await expect(page).toHaveURL('/atendimentos');
    await expect(heading).toHaveAttribute('data-mount-probe', probe);
  });

  test('faixa fechada deixa de ocupar espaço no desktop e no viewport estreito', async ({
    page
  }) => {
    await loginPage(page, 'admin');
    await page.getByRole('link', { name: 'Consultar Atendimentos' }).click();
    const heading = page.getByRole('heading', { name: 'Atendimentos' });
    await expect(heading).toBeVisible();

    const leftOpen = (await visibleBox(heading)).x;
    expect(leftOpen).toBeGreaterThan(conteudoComFaixaMinLeftPx);

    await fecharFaixa(page).click();
    await expect(abrirFaixa(page)).toBeVisible();
    const leftClosed = (await visibleBox(heading)).x;
    expect(leftClosed).toBeLessThan(conteudoSemFaixaMaxLeftPx);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(abrirFaixa(page)).toBeInViewport();
    const topClosed = (await visibleBox(heading)).y;
    await abrirFaixa(page).click();
    await expect(cascaChrome(page)).toBeVisible();
    const topOpen = (await visibleBox(heading)).y;
    expect(topOpen).toBeGreaterThan(topClosed + faixaEstreitaMinShiftPx);

    await fecharFaixa(page).click();
    await expect(abrirFaixa(page)).toBeInViewport();
    const topClosedAgain = (await visibleBox(heading)).y;
    expect(topClosedAgain).toBeLessThan(topOpen - faixaEstreitaMinShiftPx);
  });
});
