import type { LoginRequest, SessionUser } from '@hq-geap/contracts/auth';
import { compare } from 'bcryptjs';
import type { AuthRepository, AuthUser } from './repository.js';

const dummyPasswordHash =
  '$2b$10$3wP9c301Ju6DL74b8ze5luBkrzbm0LVQu42k5AawZJP2Ywt.Wl9NC';

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

export function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}
