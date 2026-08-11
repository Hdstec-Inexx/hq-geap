import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { loginPage } from '../support/e2e-auth.js';

async function settleAfterPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );
}

async function refreshPerfilOnFocus(page: Page) {
  const perfilGet = page.waitForResponse(
    (response) =>
      response.url().includes('/me') &&
      response.request().method() === 'GET' &&
      response.ok(),
    { timeout: 15_000 }
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await perfilGet;
  await settleAfterPaint(page);
}

async function markMountProbe(
  locator: ReturnType<Page['getByRole']>
): Promise<string> {
  return locator.evaluate((el) => {
    const token = `mount-${Date.now()}`;
    el.setAttribute('data-mount-probe', token);
    return token;
  });
}

async function scrollAuthenticatedPage(
  locator: ReturnType<Page['getByRole']>,
  rootSelector: 'section' | 'main'
) {
  await locator.evaluate((el, selector) => {
    const pageRoot = el.closest(selector) ?? el.parentElement;
    if (!pageRoot) {
      throw new Error('página autenticada não encontrada');
    }
    const spacer = document.createElement('div');
    spacer.setAttribute('data-scroll-spacer', '1');
    spacer.style.height = '4000px';
    pageRoot.appendChild(spacer);
    window.scrollTo(0, 1200);
  }, rootSelector);
  await expect
    .poll(async () => locator.page().evaluate(() => window.scrollY))
    .toBeGreaterThan(500);
}

/** After /me settles, remount would refetch/reconnect in the same turn. */
async function assertStableAfterPerfilRefresh(assert: () => void) {
  for (let i = 0; i < 5; i += 1) {
    assert();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function stubLiveMonitoramento(page: Page) {
  let liveSockets = 0;
  let route: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/monitoramento\/conversas\//, (ws) => {
    liveSockets += 1;
    route = ws;
    ws.onMessage((message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message));
      } catch {
        return;
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('type' in parsed) ||
        parsed.type !== 'auth'
      ) {
        return;
      }
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(
        JSON.stringify({
          type: 'transcript',
          role: 'agent',
          message: 'Linha estável antes do foco'
        })
      );
    });
  });
  return {
    get liveSockets() {
      return liveSockets;
    },
    get route() {
      return route;
    }
  };
}

test('refresh de Perfil no foco preserva mount e scroll', async ({ page }) => {
  await loginPage(page, 'curador');

  const heading = page.getByRole('heading', { name: /Olá,/ });
  await expect(heading).toBeVisible();

  const probe = await markMountProbe(heading);
  await scrollAuthenticatedPage(heading, 'section');
  await refreshPerfilOnFocus(page);

  await expect.soft(heading).toHaveAttribute('data-mount-probe', probe);
  await expect
    .soft.poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(500);
});

test('Perfil igual no foco não refaz fetch do Dashboard', async ({ page }) => {
  let dashboardGets = 0;
  await page.route('**/dashboards/gestao**', async (route) => {
    if (route.request().method() === 'GET') {
      dashboardGets += 1;
    }
    await route.continue();
  });

  await loginPage(page, 'gestao');
  await page.goto('/dashboard');

  const heading = page.getByRole('heading', { name: 'Pulso da operação' });
  await expect(heading).toBeVisible();
  await expect(page.getByLabel('Carregando dashboard')).toHaveCount(0);
  await expect.poll(() => dashboardGets).toBeGreaterThan(0);

  const probe = await markMountProbe(heading);
  await scrollAuthenticatedPage(heading, 'main');

  const dashboardGetsBeforeFocus = dashboardGets;
  await refreshPerfilOnFocus(page);
  await assertStableAfterPerfilRefresh(() => {
    expect(dashboardGets).toBe(dashboardGetsBeforeFocus);
  });

  await expect(page.getByLabel('Carregando dashboard')).toHaveCount(0);
  await expect.soft(heading).toHaveAttribute('data-mount-probe', probe);
  await expect
    .soft.poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(500);
});

test('Perfil igual no foco não reabre WebSocket do Monitoramento ao Vivo', async ({
  page
}) => {
  const live = await stubLiveMonitoramento(page);

  await loginPage(page, 'curador');
  await page.goto('/monitoramento/conv_perfil_igual');

  const heading = page.getByRole('heading', { name: 'Transcrição em tempo real' });
  await expect(heading).toBeVisible();
  await expect(page.getByText('Observando em tempo real.')).toBeVisible();
  await expect(page.getByText('Linha estável antes do foco')).toBeVisible();
  await expect.poll(() => live.liveSockets).toBeGreaterThan(0);
  expect(live.route).toBeTruthy();

  const probe = await markMountProbe(heading);
  const socketsBeforeFocus = live.liveSockets;
  await refreshPerfilOnFocus(page);
  await assertStableAfterPerfilRefresh(() => {
    expect(live.liveSockets).toBe(socketsBeforeFocus);
  });

  await expect(page.getByText('Observando em tempo real.')).toBeVisible();
  await expect(page.getByText('Linha estável antes do foco')).toBeVisible();
  await expect.soft(heading).toHaveAttribute('data-mount-probe', probe);
});
