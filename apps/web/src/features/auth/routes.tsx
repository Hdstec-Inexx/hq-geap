import type { UserRole } from '@hq-geap/contracts/auth';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  clearSession,
  getSession,
  saveSession,
  validateSession
} from './session';

type AccessState = 'checking' | 'authenticated' | 'anonymous';

const roleNames = {
  admin: 'Admin',
  gestao: 'Gestão',
  curador: 'Curador'
} as const;

export function RequireSession() {
  const location = useLocation();
  const [session] = useState(getSession);
  const [state, setState] = useState<AccessState>(
    session ? 'checking' : 'anonymous'
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    const controller = new AbortController();
    validateSession(session.token, controller.signal)
      .then((user) => {
        saveSession({ token: session.token, user });
        setState('authenticated');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          clearSession();
          setState('anonymous');
        }
      });

    return () => controller.abort();
  }, [session]);

  if (state === 'anonymous') {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }
  if (state === 'checking') {
    return <p className="session-check">Validando acesso...</p>;
  }
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: UserRole[] }) {
  const session = getSession();
  if (!session) {
    return <Navigate replace to="/login" />;
  }
  if (session.user.role === 'admin' || roles.includes(session.user.role)) {
    return <Outlet />;
  }
  return (
    <section className="session-page">
      <div>
        <p className="eyebrow">Permissão insuficiente</p>
        <h1>Acesso não autorizado</h1>
        <p className="summary">
          Seu papel não permite acessar esta área do HQ GEAP.
        </p>
      </div>
    </section>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const session = getSession();
  if (!session) {
    return <Navigate replace to="/login" />;
  }

  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <section className="session-page">
      <div>
        <p className="eyebrow">Sessão ativa / {roleNames[session.user.role]}</p>
        <h1>Olá, {session.user.name}</h1>
        <p className="summary">
          Seu acesso está pronto. As áreas do HQ GEAP serão liberadas conforme
          as permissões de {roleNames[session.user.role]}.
        </p>
      </div>
      <aside className="identity-card">
        <span className="identity-role">{roleNames[session.user.role]}</span>
        <strong>{session.user.name}</strong>
        <span>{session.user.email}</span>
        <button className="secondary-button" onClick={logout} type="button">
          Sair
        </button>
      </aside>
    </section>
  );
}
