import { expect, test } from '@playwright/test';
import { loginPage } from '../support/e2e-auth.js';

test('refresh de Perfil no foco preserva mount e scroll', async ({ page }) => {
  await loginPage(page, 'curador');

  const heading = page.getByRole('heading', { name: /Olá,/ });
  await expect(heading).toBeVisible();

  const probe = await heading.evaluate((el) => {
    const token = `mount-${Date.now()}`;
    el.setAttribute('data-mount-probe', token);
    return token;
  });

  await page.evaluate(() => {
    const pageRoot = document.querySelector('section.session-page');
    if (!pageRoot) {
      throw new Error('página autenticada não encontrada');
    }
    const spacer = document.createElement('div');
    spacer.setAttribute('data-scroll-spacer', '1');
    spacer.style.height = '4000px';
    pageRoot.appendChild(spacer);
    window.scrollTo(0, 1200);
  });
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(500);

  const perfilGet = page.waitForResponse(
    (response) =>
      response.url().includes('/me') &&
      response.request().method() === 'GET' &&
      response.ok(),
    { timeout: 15_000 }
  );

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await perfilGet;

  await expect.soft(heading).toHaveAttribute('data-mount-probe', probe);
  expect.soft(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
});
