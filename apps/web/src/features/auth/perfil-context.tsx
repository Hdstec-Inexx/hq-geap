import {
  canDownloadAudio,
  type Perfil,
  type UserRole
} from '@hq-geap/contracts/auth';
import { createContext, useContext, type ReactNode } from 'react';
import { getPerfil } from './session';

export { canDownloadAudio };

const PerfilContext = createContext<Perfil | null | undefined>(undefined);

export function PerfilProvider({
  value,
  children
}: {
  value: Perfil | null;
  children: ReactNode;
}) {
  return (
    <PerfilContext.Provider value={value}>{children}</PerfilContext.Provider>
  );
}

/** Runtime Perfil from RequireSession context; falls back to session storage. */
export function usePerfil(): Perfil | null {
  const fromContext = useContext(PerfilContext);
  if (fromContext !== undefined) {
    return fromContext;
  }
  return getPerfil();
}

/** Admin and Curador may mutate curadoria/comentários; Gestão is read-only. */
export function canWriteAsCurador(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'curador';
}

export function samePerfil(a: Perfil | null, b: Perfil | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.name === b.name &&
    a.role === b.role
  );
}
