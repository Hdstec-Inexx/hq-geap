import { expect, test, type APIRequestContext } from '@playwright/test';
import { authUsers } from '../support/auth-fixtures.js';

const apiUrl = 'http://127.0.0.1:3000';

async function login(
  request: APIRequestContext,
  role: 'admin' | 'gestao' | 'curador'
) {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { token: string };
}

test.describe('consulta da Regua de Avaliacao', () => {
  test('somente Admin consulta a Regua vigente e a API nao oferece mutacoes', async ({
    request
  }) => {
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');
    const curador = await login(request, 'curador');
    const endpoint = `${apiUrl}/admin/criterios`;

    for (const token of [gestao.token, curador.token]) {
      const response = await request.get(endpoint, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.status()).toBe(403);
    }

    const headers = { authorization: `Bearer ${admin.token}` };
    const response = await request.get(endpoint, { headers });
    expect(response.status()).toBe(200);
    const regua = await response.json();
    expect(regua).toMatchObject({
      vigente: true,
      total: 10,
      limiarAprovacao: 7
    });
    expect(regua.criterios).toHaveLength(7);
    expect(regua.criterios.map((criterio: { ordem: number }) => criterio.ordem)).toEqual([
      1, 2, 3, 4, 5, 6, 7
    ]);
    expect(
      regua.criterios.reduce(
        (total: number, criterio: { valor: number }) => total + criterio.valor,
        0
      )
    ).toBe(10);
    expect(regua.criterios).toContainEqual(
      expect.objectContaining({
        chave: 'informou_protocolo_email',
        nome: 'Informação de Protocolo',
        valor: 2.5,
        critico: true,
        condicional: false,
        ordem: 3
      })
    );
    expect(regua.criterios).toContainEqual(
      expect.objectContaining({
        chave: 'validou_email_por_extenso',
        condicional: true
      })
    );

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const mutation = await request[method](endpoint, {
        data: { nome: 'Critério adulterado' },
        headers
      });
      expect(mutation.status()).toBe(404);
    }
  });

  test('Admin consulta os Critérios em uma interface somente leitura', async ({ page }) => {
    const admin = authUsers.find((candidate) => candidate.role === 'admin')!;
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(admin.email);
    await page.getByLabel('Senha').fill(admin.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('link', { name: 'Consultar Régua de Avaliação' }).click();

    await expect(
      page.getByRole('heading', { name: 'Régua de Avaliação' })
    ).toBeVisible();
    await expect(page.getByText('10,0 pontos')).toBeVisible();
    await expect(page.getByText('Informação de Protocolo')).toBeVisible();
    await expect(page.getByText('Crítico', { exact: true })).toBeVisible();
    await expect(page.getByText('Condicional', { exact: true })).toBeVisible();
    const criterioCritico = page
      .locator('[data-testid="criterio-regua"]')
      .filter({ hasText: 'Informação de Protocolo' });
    await expect(criterioCritico.getByText('Crítico', { exact: true })).toBeVisible();
    await expect(
      criterioCritico.getByText('Aplicação obrigatória', { exact: true })
    ).toBeVisible();
    const criterioNaoCritico = page
      .locator('[data-testid="criterio-regua"]')
      .filter({ hasText: 'Saudação e Intenção' });
    await expect(
      criterioNaoCritico.getByText('Não crítico', { exact: true })
    ).toBeVisible();
    await expect(page.locator('[data-testid="criterio-regua"]')).toHaveCount(7);
    await expect(page.locator('form')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /criar|editar|ativar|desativar|excluir/i })
    ).toHaveCount(0);
  });

  for (const user of authUsers.filter(({ role }) => role !== 'admin')) {
    test(`${user.role} nao acessa a area administrativa da Regua`, async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(user.email);
      await page.getByLabel('Senha').fill(user.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(
        page.getByRole('link', { name: 'Consultar Régua de Avaliação' })
      ).toHaveCount(0);

      await page.goto('/admin/criterios');
      await expect(
        page.getByRole('heading', { name: 'Acesso não autorizado' })
      ).toBeVisible();
    });
  }
});
