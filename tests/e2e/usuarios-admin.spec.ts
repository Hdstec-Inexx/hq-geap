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

  test('Admin redefine senha alheia, nao-admin recebe 403 e token antigo deixa de autenticar', async ({
    request
  }) => {
    const admin = await login(request, 'admin');
    const gestao = await login(request, 'gestao');
    const curadorSession = await login(request, 'curador');
    const adminHeaders = { authorization: `Bearer ${admin.token}` };
    const targetEmail = `reset-senha-${Date.now()}@hq.test`;

    const created = await request.post(`${apiUrl}/admin/usuarios`, {
      data: {
        email: targetEmail,
        name: 'Alvo reset senha',
        password: 'senha-antiga',
        role: 'curador'
      },
      headers: adminHeaders
    });
    expect(created.status()).toBe(201);
    const target = (await created.json()) as { id: string };

    const targetLogin = await request.post(`${apiUrl}/auth/login`, {
      data: { email: targetEmail, password: 'senha-antiga' }
    });
    expect(targetLogin.status()).toBe(200);
    const oldToken = ((await targetLogin.json()) as { token: string }).token;
    const oldHeaders = { authorization: `Bearer ${oldToken}` };
    expect((await request.get(`${apiUrl}/me`, { headers: oldHeaders })).status()).toBe(
      200
    );

    for (const token of [gestao.token, curadorSession.token]) {
      expect(
        (
          await request.post(`${apiUrl}/admin/usuarios/${target.id}/senha`, {
            data: { password: 'senha-nova-segura' },
            headers: { authorization: `Bearer ${token}` }
          })
        ).status()
      ).toBe(403);
    }

    const weakPassword = await request.post(
      `${apiUrl}/admin/usuarios/${target.id}/senha`,
      {
        data: { password: 'curta' },
        headers: adminHeaders
      }
    );
    expect(weakPassword.status()).toBe(400);

    const reset = await request.post(`${apiUrl}/admin/usuarios/${target.id}/senha`, {
      data: { password: 'senha-nova-segura' },
      headers: adminHeaders
    });
    expect(reset.status()).toBe(200);
    const resetBody = await reset.json();
    expect(resetBody).toMatchObject({
      id: target.id,
      email: targetEmail,
      active: true
    });
    expect(resetBody).not.toHaveProperty('passwordHash');

    expect((await request.get(`${apiUrl}/me`, { headers: oldHeaders })).status()).toBe(
      401
    );

    const staleLogin = await request.post(`${apiUrl}/auth/login`, {
      data: { email: targetEmail, password: 'senha-antiga' }
    });
    expect(staleLogin.status()).toBe(401);

    const freshLogin = await request.post(`${apiUrl}/auth/login`, {
      data: { email: targetEmail, password: 'senha-nova-segura' }
    });
    expect(freshLogin.status()).toBe(200);
    const freshToken = ((await freshLogin.json()) as { token: string }).token;
    expect(
      (
        await request.get(`${apiUrl}/me`, {
          headers: { authorization: `Bearer ${freshToken}` }
        })
      ).status()
    ).toBe(200);
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
    await expect(page.getByRole('link', { name: 'Voltar ao início' })).toBeVisible();
    await page.getByRole('button', { name: 'Novo usuário' }).click();
    await page.getByLabel('Nome').fill('Usuario pela interface');
    await page.getByLabel('E-mail', { exact: true }).fill('usuario-ui@hq.test');
    const initialPassword = page.getByLabel('Senha inicial');
    await initialPassword.fill('senha-interface');
    await expect(initialPassword).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(initialPassword).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await expect(initialPassword).toHaveAttribute('type', 'password');
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

  test('Admin redefine senha na UI com toggle e forca novo login do alvo', async ({
    page,
    request
  }) => {
    const admin = await login(request, 'admin');
    const adminHeaders = { authorization: `Bearer ${admin.token}` };
    const targetEmail = `ui-reset-${Date.now()}@hq.test`;
    const created = await request.post(`${apiUrl}/admin/usuarios`, {
      data: {
        email: targetEmail,
        name: 'Usuario reset UI',
        password: 'senha-antiga-ui',
        role: 'curador'
      },
      headers: adminHeaders
    });
    expect(created.status()).toBe(201);

    const targetLogin = await request.post(`${apiUrl}/auth/login`, {
      data: { email: targetEmail, password: 'senha-antiga-ui' }
    });
    expect(targetLogin.status()).toBe(200);
    const oldToken = ((await targetLogin.json()) as { token: string }).token;

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: 'Administrar usuários' }).click();
    await expect(page.getByRole('link', { name: 'Voltar ao início' })).toBeVisible();

    const row = page.getByRole('row', { name: /Usuario reset UI/ });
    await row.getByRole('button', { name: 'Definir senha' }).click();
    const newPassword = page.getByLabel('Nova senha');
    await newPassword.fill('senha-nova-ui');
    await expect(newPassword).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(newPassword).toHaveAttribute('type', 'text');
    await expect(newPassword).toHaveValue('senha-nova-ui');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('heading', { name: 'Definir senha' })).toHaveCount(0);

    expect(
      (
        await request.get(`${apiUrl}/me`, {
          headers: { authorization: `Bearer ${oldToken}` }
        })
      ).status()
    ).toBe(401);

    const freshLogin = await request.post(`${apiUrl}/auth/login`, {
      data: { email: targetEmail, password: 'senha-nova-ui' }
    });
    expect(freshLogin.status()).toBe(200);

    await page.getByRole('link', { name: 'Voltar ao início' }).click();
    await expect(page).toHaveURL('/');
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
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const raw = window.sessionStorage.getItem('hq-geap.perfil');
            return raw ? (JSON.parse(raw) as { role: string }).role : null;
          }),
        { timeout: 10_000 }
      )
      .toBe('gestao');
    await expect(
      page.getByRole('heading', { name: 'Acesso não autorizado' })
    ).toBeVisible();

    const deactivation = await request.post(
      `${apiUrl}/admin/usuarios/${revoked.id}/desativar`,
      { headers }
    );
    expect(deactivation.status()).toBe(200);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL('/login', { timeout: 10_000 });
  });
});
