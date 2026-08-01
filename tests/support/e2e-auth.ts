import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { authUsers } from './auth-fixtures.js';

const apiUrl = 'http://127.0.0.1:3000';

export type AuthRole = (typeof authUsers)[number]['role'];

export type SlimSession = {
  token: string;
  user: { id: string };
};

export type Perfil = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
};

export function authUserFor(role: AuthRole) {
  return authUsers.find((candidate) => candidate.role === role)!;
}

/** Login API: sessão magra (token + id); Perfil vem de GET /me. */
export async function loginApi(
  request: APIRequestContext,
  role: AuthRole
): Promise<SlimSession> {
  const user = authUserFor(role);
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  expect(response.status()).toBe(200);
  const session = (await response.json()) as SlimSession;
  expect(session).toEqual({
    token: expect.any(String),
    user: { id: expect.any(String) }
  });
  expect(session.user).not.toHaveProperty('name');
  expect(session.user).not.toHaveProperty('email');
  expect(session.user).not.toHaveProperty('role');
  return session;
}

export async function fetchPerfil(
  request: APIRequestContext,
  token: string
): Promise<Perfil> {
  const response = await request.get(`${apiUrl}/me`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Perfil;
}

/** Login pela UI; aguarda home com nome do Perfil (não confia em session.user). */
export async function loginPage(page: Page, role: AuthRole) {
  const user = authUserFor(role);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { name: `Olá, ${user.name}` })
  ).toBeVisible();
}
