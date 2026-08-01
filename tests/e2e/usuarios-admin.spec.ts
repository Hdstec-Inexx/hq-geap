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
  return (await response.json()) as { token: string; user: { id: string } };
}

test.describe.serial('administracao de usuarios', () => {
  test('somente Admin lista, cria, edita, atribui papel e desativa usuarios', async ({
    request
  }) => {
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');
    const curadorSession = await login(request, 'curador');
    const adminHeaders = { authorization: `Bearer ${admin.token}` };

    for (const token of [gestao.token, curadorSession.token]) {
      const headers = { authorization: `Bearer ${token}` };
      expect((await request.get(`${apiUrl}/admin/usuarios`, { headers })).status()).toBe(
        403
      );
      expect(
        (
          await request.post(`${apiUrl}/admin/usuarios`, {
            data: {
              email: `proibido-${token.slice(-6)}@hq.test`,
              name: 'Sem permissao',
              password: 'senha-segura',
              role: 'curador'
            },
            headers
          })
        ).status()
      ).toBe(403);
      expect(
        (
          await request.patch(
            `${apiUrl}/admin/usuarios/00000000-0000-4000-8000-000000000000`,
            {
              data: {
                email: 'proibido@hq.test',
                name: 'Sem permissao',
                role: 'admin'
              },
              headers
            }
          )
        ).status()
      ).toBe(403);
      expect(
        (
          await request.post(
            `${apiUrl}/admin/usuarios/00000000-0000-4000-8000-000000000000/desativar`,
            { headers }
          )
        ).status()
      ).toBe(403);
    }

    const selfDemotion = await request.patch(
      `${apiUrl}/admin/usuarios/${admin.user.id}`,
      {
        data: {
          email: 'admin@hq.test',
          name: 'Admin de teste',
          role: 'gestao'
        },
        headers: adminHeaders
      }
    );
    const selfDeactivation = await request.post(
      `${apiUrl}/admin/usuarios/${admin.user.id}/desativar`,
      { headers: adminHeaders }
    );
    expect(selfDemotion.status()).toBe(409);
    expect(selfDeactivation.status()).toBe(409);

    const createdUsers: Array<{ id: string; role: string }> = [];
    for (const role of ['admin', 'gestao', 'curador'] as const) {
      const response = await request.post(`${apiUrl}/admin/usuarios`, {
        data: {
          email: `novo-${role}@hq.test`,
          name: `Novo ${role}`,
          password: 'senha-segura',
          role
        },
        headers: adminHeaders
      });

      expect(response.status()).toBe(201);
      const created = await response.json();
      expect(created).toMatchObject({
        active: true,
        email: `novo-${role}@hq.test`,
        name: `Novo ${role}`,
        role
      });
      expect(created).not.toHaveProperty('passwordHash');
      createdUsers.push(created);
    }

    const duplicate = await request.post(`${apiUrl}/admin/usuarios`, {
      data: {
        email: 'NOVO-CURADOR@HQ.TEST',
        name: 'Email repetido',
        password: 'senha-segura',
        role: 'curador'
      },
      headers: adminHeaders
    });
    expect(duplicate.status()).toBe(409);

    const curador = createdUsers.find((user) => user.role === 'curador')!;
    const update = await request.patch(`${apiUrl}/admin/usuarios/${curador.id}`, {
      data: {
        email: 'curador-promovido@hq.test',
        name: 'Curador promovido',
        role: 'gestao'
      },
      headers: adminHeaders
    });
    expect(update.status()).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      active: true,
      email: 'curador-promovido@hq.test',
      name: 'Curador promovido',
      role: 'gestao'
    });

    const list = await request.get(`${apiUrl}/admin/usuarios`, {
      headers: adminHeaders
    });
    expect(list.status()).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({ email: 'curador-promovido@hq.test' })
      ]),
      page: 1,
      pageSize: 20,
      total: expect.any(Number)
    });
    const excessivePage = await request.get(
      `${apiUrl}/admin/usuarios?page=1&pageSize=101`,
      { headers: adminHeaders }
    );
    expect(excessivePage.status()).toBe(400);

    const deactivate = await request.post(
      `${apiUrl}/admin/usuarios/${curador.id}/desativar`,
      { headers: adminHeaders }
    );
    expect(deactivate.status()).toBe(200);
    await expect(deactivate.json()).resolves.toMatchObject({ active: false });

    const inactiveLogin = await request.post(`${apiUrl}/auth/login`, {
      data: { email: 'curador-promovido@hq.test', password: 'senha-segura' }
    });
    expect(inactiveLogin.status()).toBe(401);
  });

  test('Admin cria, edita e desativa na interface sem recarregar o app', async ({
    page
  }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: 'Administrar usuários' }).click();

    await expect(
      page.getByRole('heading', { name: 'Administração de usuários' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Novo usuário' }).click();
    await page.getByLabel('Nome').fill('Usuario pela interface');
    await page.getByLabel('E-mail', { exact: true }).fill('usuario-ui@hq.test');
    await page.getByLabel('Senha inicial').fill('senha-interface');
    await page.getByLabel('Papel').selectOption('curador');
    await page.getByRole('button', { name: 'Criar usuário' }).click();

    const row = page.getByRole('row', { name: /Usuario pela interface/ });
    await expect(row).toContainText('Curador');
    await expect(row).toContainText('Ativo');

    await row.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Nome').fill('Usuario editado');
    await page.getByLabel('Papel').selectOption('gestao');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    const editedRow = page.getByRole('row', { name: /Usuario editado/ });
    await expect(editedRow).toBeVisible();
    await expect(editedRow).toContainText('Gestão');
    await editedRow.getByRole('button', { name: 'Desativar' }).click();
    await expect(editedRow).toContainText('Inativo');
  });

  test('sessao rebaixada ou desativada sai da area administrativa ao retomar foco', async ({
    page,
    request
  }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('novo-admin@hq.test');
    await page.getByLabel('Senha').fill('senha-segura');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: 'Administrar usuários' }).click();

    const admin = await login(request, 'admin');
    const headers = { authorization: `Bearer ${admin.token}` };
    const list = await request.get(`${apiUrl}/admin/usuarios`, { headers });
    const users = (await list.json()) as {
      users: Array<{ id: string; email: string; name: string }>;
    };
    const revoked = users.users.find((user) => user.email === 'novo-admin@hq.test')!;
    const demotion = await request.patch(`${apiUrl}/admin/usuarios/${revoked.id}`, {
      data: { email: revoked.email, name: revoked.name, role: 'gestao' },
      headers
    });
    expect(demotion.status()).toBe(200);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('heading', { name: 'Acesso não autorizado' })
    ).toBeVisible();

    const deactivation = await request.post(
      `${apiUrl}/admin/usuarios/${revoked.id}/desativar`,
      { headers }
    );
    expect(deactivation.status()).toBe(200);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL('/login');
  });
});
