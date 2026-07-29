import {
  loginResponseSchema,
  sessionUserSchema,
  type LoginResponse,
  type SessionUser
} from '@hq-geap/contracts/auth';

const sessionKey = 'hq-geap.session';

export const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function getSession(): LoginResponse | null {
  const stored = window.sessionStorage.getItem(sessionKey);
  if (!stored) {
    return null;
  }

  try {
    const session = loginResponseSchema.safeParse(JSON.parse(stored));
    if (session.success) {
      return session.data;
    }
  } catch {
    // Invalid browser state is treated as an expired session.
  }

  clearSession();
  return null;
}

export function saveSession(session: LoginResponse) {
  window.sessionStorage.setItem(
    sessionKey,
    JSON.stringify(loginResponseSchema.parse(session))
  );
}

export function clearSession() {
  window.sessionStorage.removeItem(sessionKey);
}

export async function validateSession(
  token: string,
  signal: AbortSignal
): Promise<SessionUser> {
  const response = await fetch(`${apiUrl}/auth/session`, {
    headers: { authorization: `Bearer ${token}` },
    signal
  });
  if (!response.ok) {
    throw new Error(`Session request failed with ${response.status}`);
  }
  return sessionUserSchema.parse(await response.json());
}
