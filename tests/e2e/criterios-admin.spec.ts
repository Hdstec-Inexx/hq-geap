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
  test('todos os papeis autenticados consultam a Regua vigente e a API nao oferece mutacoes nem acesso anonimo', async ({
    request
  }) => {
    const endpoint = `${apiUrl}/admin/criterios`;

    const anonResponse = await request.get(endpoint);
    expect(anonResponse.status()).toBe(401);

    for (const role of ['admin', 'gestao', 'curador'] as const) {
      const session = await login(request, role);
      const headers = { authorization: `Bearer ${session.token}` };
      const response = await request.get(endpoint, { headers });
      expect(response.status()).toBe(200);
      const regua = await response.json();
      expect(regua).toMatchObject({
        vigente: true,
        total: 10,
        limiarAprovacao: 7
      });
      expect(regua.criterios).toHaveLength(8);
      expect(regua.criterios.map((criterio: { ordem: number }) => criterio.ordem)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8
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
      expect(regua.criterios).toContainEqual(
        expect.objectContaining({
          chave: 'uso_correto_ferramentas',
          nome: 'Uso Correto de Ferramentas',
          valor: 0,
          critico: false,
          condicional: false,
          ordem: 8
        })
      );
    }

    const admin = await login(request, 'admin');
    const adminHeaders = { authorization: `Bearer ${admin.token}` };
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const mutation = await request[method](endpoint, {
        data: { nome: 'Critério adulterado' },
        headers: adminHeaders
      });
      expect(mutation.status()).toBe(404);
    }
  });

  for (const user of authUsers) {
    test(`${user.role} consulta os Critérios em uma interface somente leitura sem rodapé técnico`, async ({
      page
    }) => {
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(user.email);
      await page.getByLabel('Senha').fill(user.password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.getByRole('link', { name: 'Consultar Régua de Avaliação' }).click();

      await expect(page).toHaveURL('/admin/criterios');
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
      await expect(page.getByText('Uso Correto de Ferramentas')).toBeVisible();
      await expect(page.getByText('0,0 pt')).toBeVisible();
      await expect(page.locator('[data-testid="criterio-regua"]')).toHaveCount(8);
      await expect(page.locator('form')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /criar|editar|ativar|desativar|excluir/i })
      ).toHaveCount(0);
      await expect(
        page.getByText(/Alterações exigem uma nova Régua válida por código e preservam os snapshots/i)
      ).toHaveCount(0);
      await expect(
        page.getByText(/snapshots de Avaliações anteriores/i)
      ).toHaveCount(0);
    });
  }
});
