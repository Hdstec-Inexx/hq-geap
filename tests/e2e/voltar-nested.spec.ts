import { expect, test, type Page } from '@playwright/test';
import { loginPage } from '../support/e2e-auth.js';

async function expectBackToHome(page: Page) {
  const back = page.getByRole('link', { name: 'Voltar ao início' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL('/');
}

test.describe('voltar nas telas nested', () => {
  test('Criterios, Configuracao da IA, Comentarios pendentes e Fila de Curadoria voltam ao inicio', async ({
    page
  }) => {
    await loginPage(page, 'admin');

    await page.getByRole('link', { name: 'Consultar Régua de Avaliação' }).click();
    await expect(
      page.getByRole('heading', { name: 'Régua de Avaliação' })
    ).toBeVisible();
    await expectBackToHome(page);

    await page.getByRole('link', { name: 'Configurar IA Avaliadora' }).click();
    await expect(
      page.getByRole('heading', { name: 'Configuração da IA Avaliadora' })
    ).toBeVisible();
    await expectBackToHome(page);

    await page.getByRole('link', { name: 'Trabalhar fila de manutenção' }).click();
    await expect(
      page.getByRole('heading', { name: 'Fila de manutenção' })
    ).toBeVisible();
    await expectBackToHome(page);

    await page.getByRole('link', { name: 'Abrir Fila de Curadoria' }).click();
    await expect(
      page.getByRole('heading', { name: 'Fila de Curadoria' })
    ).toBeVisible();
    await expectBackToHome(page);

    await page.getByRole('link', { name: 'Curadorias Realizadas' }).click();
    await expect(
      page.getByRole('heading', { name: 'Curadorias Realizadas' })
    ).toBeVisible();
    await expectBackToHome(page);
  });

  test('Minhas Curadorias do curador volta ao inicio', async ({ page }) => {
    await loginPage(page, 'curador');

    await page.getByRole('link', { name: 'Minhas Curadorias' }).click();
    await expect(
      page.getByRole('heading', { name: 'Minhas Curadorias' })
    ).toBeVisible();
    await expectBackToHome(page);
  });


  test('Home e Dashboard raiz nao exigem voltar', async ({ page }) => {
    await loginPage(page, 'admin');

    await expect(page.getByRole('link', { name: 'Voltar ao início' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Abrir Dashboard da Gestão' }).click();
    await expect(page.getByRole('heading', { name: 'Pulso da operação' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar ao início' })).toHaveCount(0);
  });
});
