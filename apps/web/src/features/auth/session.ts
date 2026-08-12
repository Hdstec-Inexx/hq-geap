import {
  loginResponseSchema,
  perfilSchema,
  type LoginResponse,
  type Perfil
} from '@hq-geap/contracts/auth';

const sessionKey = 'hq-geap.session';
const perfilKey = 'hq-geap.perfil';
const lastMeAtKey = 'hq-geap.last-me-at';

export const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Min gap between successful /me validations (dedupe mount+focus / bursts). */
export const perfilRefreshMinGapMs = 2000;

export class AuthExpiredError extends Error {
  constructor(message = 'Authentication expired') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

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

export function getPerfil(): Perfil | null {
  const stored = window.sessionStorage.getItem(perfilKey);
  if (!stored) {
    return null;
  }

  try {
    const perfil = perfilSchema.safeParse(JSON.parse(stored));
    if (perfil.success) {
      return perfil.data;
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

export function savePerfil(perfil: Perfil) {
  window.sessionStorage.setItem(
    perfilKey,
    JSON.stringify(perfilSchema.parse(perfil))
  );
}

export function markPerfilValidatedAt(at = Date.now()) {
  window.sessionStorage.setItem(lastMeAtKey, String(at));
}

export function lastPerfilValidatedAt(): number {
  const raw = window.sessionStorage.getItem(lastMeAtKey);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** True when a successful /me ran recently enough to skip another trigger. */
export function wasPerfilValidatedRecently(
  gapMs = perfilRefreshMinGapMs,
  now = Date.now()
): boolean {
  return now - lastPerfilValidatedAt() < gapMs;
}

export function clearSession() {
  window.sessionStorage.removeItem(sessionKey);
  window.sessionStorage.removeItem(perfilKey);
  window.sessionStorage.removeItem(lastMeAtKey);
}

async function readAuthenticatedJson(
  path: string,
  token: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal
  });
  if (response.status === 401 || response.status === 403) {
    throw new AuthExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return response.json();
}

export async function fetchPerfil(
  token: string,
  signal?: AbortSignal
): Promise<Perfil> {
  return perfilSchema.parse(await readAuthenticatedJson('/me', token, signal));
}
