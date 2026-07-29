import { expect, test } from '@playwright/test';

test('a tela de saúde confirma a API e o banco pela fronteira HTTP', async ({
  page,
  request
}) => {
  await page.goto('/health');

  await expect(
    page.getByRole('heading', { name: 'HQ GEAP está operacional' })
  ).toBeVisible();
  await expect(page.getByText('API e banco operacionais')).toBeVisible();

  const response = await request.get('http://127.0.0.1:3000/health');

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: 'ok',
    database: 'ok'
  });
});
