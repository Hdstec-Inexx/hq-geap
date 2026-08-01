import type {
  LoginRequest,
  Perfil,
  SessionIdentity
} from '@hq-geap/contracts/auth';
import { compare } from 'bcryptjs';
import type { AuthRepository, AuthUser } from './repository.js';

const dummyPasswordHash =
  '$2b$10$3wP9c301Ju6DL74b8ze5luBkrzbm0LVQu42k5AawZJP2Ywt.Wl9NC';

/** JWT claim mirroring `usuarios.senha_versao` (short key keeps tokens small). */
export const passwordVersionClaim = 'sv' as const;

export type SessionTokenClaims = {
  sub: string;
  [passwordVersionClaim]?: number;
};

export async function authenticateUser(
  repository: AuthRepository,
  credentials: LoginRequest
): Promise<AuthUser | null> {
  const user = await repository.findActiveByEmail(credentials.email);
  const passwordMatches = await compare(
    credentials.password,
    user?.passwordHash ?? dummyPasswordHash
  );
  if (!user || !passwordMatches) {
    return null;
  }
  return user;
}

export function toSessionTokenClaims(user: AuthUser): SessionTokenClaims {
  return {
    sub: user.id,
    [passwordVersionClaim]: user.passwordVersion
  };
}

export function sessionMatchesPasswordVersion(
  claims: SessionTokenClaims,
  currentPasswordVersion: number
) {
  return (claims[passwordVersionClaim] ?? 0) === currentPasswordVersion;
}

export function toSessionIdentity(user: AuthUser): SessionIdentity {
  return { id: user.id };
}

export function toPerfil(user: AuthUser): Perfil {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}
