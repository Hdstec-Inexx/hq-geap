import type { Perfil, UserRole } from '@hq-geap/contracts/auth';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PerfilProvider, samePerfil, usePerfil } from './perfil-context';
import {
  AuthExpiredError,
  clearSession,
  fetchPerfil,
  getPerfil,
  getSession,
  markPerfilValidatedAt,
  perfilRefreshMinGapMs,
  savePerfil,
  wasPerfilValidatedRecently
} from './session';

type AccessState = 'checking' | 'authenticated' | 'anonymous';
type RefreshReason = 'mount' | 'interval' | 'focus';

const roleNames = {
  admin: 'Admin',
  gestao: 'Gestão',
  curador: 'Curador'
} as const;

const focusRefreshDebounceMs = perfilRefreshMinGapMs;

export function RequireSession() {
  const location = useLocation();
  const [session] = useState(getSession);
  const [perfil, setPerfil] = useState<Perfil | null>(() => getPerfil());
  const [state, setState] = useState<AccessState>(() => {
    if (!session) return 'anonymous';
    return getPerfil() ? 'authenticated' : 'checking';
  });
  const perfilRef = useRef(perfil);
  const stateRef = useRef(state);
  perfilRef.current = perfil;
  stateRef.current = state;

  useEffect(() => {
    if (!session) {
      return;
    }

    const activeSession = session;
    const controller = new AbortController();
    let validating = false;
    let revoked = false;
    let focusTimer: number | undefined;

    async function refreshSession(reason: RefreshReason) {
      if (validating || revoked) return;
      // Dedupe focus after a recent successful /me (mount+focus burst).
      // Mount and the ~60s interval always validate for the security SLA.
      if (reason === 'focus' && wasPerfilValidatedRecently(perfilRefreshMinGapMs)) {
        return;
      }
      validating = true;
      try {
        // /me validates the token and refreshes Perfil in one round-trip.
        const nextPerfil = await fetchPerfil(activeSession.token, controller.signal);
        if (controller.signal.aborted || revoked) return;
        markPerfilValidatedAt();
        // Equal Perfil is UX no-op: keep object identity; no setPerfil.
        if (samePerfil(perfilRef.current, nextPerfil)) {
          if (stateRef.current !== 'authenticated') {
            setState('authenticated');
          }
          return;
        }
        savePerfil(nextPerfil);
        perfilRef.current = nextPerfil;
        setPerfil(nextPerfil);
        setState('authenticated');
      } catch (error) {
        if (controller.signal.aborted || revoked) return;
        if (error instanceof AuthExpiredError) {
          revoked = true;
          clearSession();
          perfilRef.current = null;
          setPerfil(null);
          setState('anonymous');
          return;
        }
        const stored = getPerfil();
        if (stored) {
          if (samePerfil(perfilRef.current, stored)) {
            if (stateRef.current !== 'authenticated') {
              setState('authenticated');
            }
            return;
          }
          perfilRef.current = stored;
          setPerfil(stored);
          setState('authenticated');
          return;
        }
        revoked = true;
        clearSession();
        perfilRef.current = null;
        setPerfil(null);
        setState('anonymous');
      } finally {
        validating = false;
      }
    }

    void refreshSession('mount');
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSession('interval');
    }, 60_000);

    function onFocus() {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void refreshSession('focus');
      }, focusRefreshDebounceMs);
    }
    window.addEventListener('focus', onFocus);
    // Test-only seam: force the same path as the 60s poll without waiting.
    (
      window as unknown as { __hqGeapRefreshPerfil?: () => void }
    ).__hqGeapRefreshPerfil = () => {
      void refreshSession('interval');
    };

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      delete (window as unknown as { __hqGeapRefreshPerfil?: () => void })
        .__hqGeapRefreshPerfil;
    };
  }, [session]);

  if (state === 'anonymous') {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }
  if (state === 'checking') {
    return <p className="session-check">Validando acesso...</p>;
  }
  return (
    <PerfilProvider value={perfil}>
      <Outlet />
    </PerfilProvider>
  );
}

export function RequireRole({ roles }: { roles: UserRole[] }) {
  const perfil = usePerfil();
  if (!perfil) {
    return <Navigate replace to="/login" />;
  }
  if (perfil.role === 'admin' || roles.includes(perfil.role)) {
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
  const perfil = usePerfil();
  if (!perfil) {
    return <Navigate replace to="/login" />;
  }

  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <section className="session-page">
      <div>
        <p className="eyebrow">Sessão ativa / {roleNames[perfil.role]}</p>
        <h1>Olá, {perfil.name}</h1>
        <p className="summary">
          Seu acesso está pronto. As áreas do HQ GEAP serão liberadas conforme
          as permissões de {roleNames[perfil.role]}.
        </p>
        {perfil.role !== 'curador' ? (
          <Link className="admin-feature-link" to="/dashboard">
            Abrir Dashboard da Gestão
          </Link>
        ) : null}
        <Link className="admin-feature-link" to="/atendimentos">
          Consultar Atendimentos
        </Link>
        <Link className="admin-feature-link" to="/monitoramento">
          Monitoramento ao Vivo
        </Link>
        <Link className="admin-feature-link" to="/curadoria">
          {perfil.role === 'gestao'
            ? 'Consultar Fila de Curadoria'
            : 'Abrir Fila de Curadoria'}
        </Link>
        {perfil.role === 'admin' ? (
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
        <span className="identity-role">{roleNames[perfil.role]}</span>
        <strong>{perfil.name}</strong>
        <span>{perfil.email}</span>
        <button className="secondary-button" onClick={logout} type="button">
          Sair
        </button>
      </aside>
    </section>
  );
}
