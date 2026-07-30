import type { UserRole } from '@hq-geap/contracts/auth';
import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  const [sessionRevision, setSessionRevision] = useState(0);
  const [state, setState] = useState<AccessState>(
    session ? 'checking' : 'anonymous'
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    const activeSession = session;
    let currentUser = activeSession.user;
    const controller = new AbortController();
    let validating = false;
    let revoked = false;

    async function refreshSession() {
      if (validating || revoked) return;
      validating = true;
      try {
        const user = await validateSession(activeSession.token, controller.signal);
        saveSession({ token: activeSession.token, user });
        if (
          user.id !== currentUser.id ||
          user.name !== currentUser.name ||
          user.email !== currentUser.email ||
          user.role !== currentUser.role
        ) {
          currentUser = user;
          setSessionRevision((current) => current + 1);
        }
        setState('authenticated');
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          revoked = true;
          clearSession();
          setState('anonymous');
        }
      } finally {
        validating = false;
      }
    }

    void refreshSession();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSession();
    }, 60_000);
    window.addEventListener('focus', refreshSession);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshSession);
    };
  }, [session]);

  if (state === 'anonymous') {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }
  if (state === 'checking') {
    return <p className="session-check">Validando acesso...</p>;
  }
  return <Outlet key={sessionRevision} />;
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
        <Link className="admin-feature-link" to="/atendimentos">
          Consultar Atendimentos
        </Link>
        <Link className="admin-feature-link" to="/curadoria">
          {session.user.role === 'gestao'
            ? 'Consultar Fila de Curadoria'
            : 'Abrir Fila de Curadoria'}
        </Link>
        {session.user.role === 'admin' ? (
          <div className="admin-feature-links">
            <Link className="admin-feature-link" to="/admin/comentarios">
              Trabalhar fila de manutenção
            </Link>
            <Link className="admin-feature-link" to="/admin/usuarios">
              Administrar usuários
            </Link>
            <Link className="admin-feature-link" to="/admin/configuracao-ia">
              Configurar IA Avaliadora
            </Link>
            <Link className="admin-feature-link" to="/admin/criterios">
              Consultar Régua de Avaliação
            </Link>
          </div>
        ) : null}
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
