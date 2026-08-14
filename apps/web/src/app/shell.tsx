import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { usePerfil } from '../features/auth/perfil-context';
import { clearSession } from '../features/auth/session';
import { areasPorPapel } from './casca-areas';
import {
  abrirFaixaDeNavegacao,
  fecharFaixaDeNavegacao
} from './casca-faixa';

function viewportEstreito() {
  return window.matchMedia('(max-width: 760px)').matches;
}

export function Shell() {
  return (
    <div className="app-shell">
      <Outlet />
    </div>
  );
}

export function AuthenticatedShell() {
  const perfil = usePerfil();
  const navigate = useNavigate();
  const [faixaAberta, setFaixaAberta] = useState(true);
  const abertaPorHover = useRef(false);
  const ignorarHoverAteSair = useRef(false);
  const focarReabrir = useRef(false);
  const reabrirRef = useRef<HTMLButtonElement>(null);
  const faixaRef = useRef<HTMLElement>(null);
  const faixaAbertaRef = useRef(faixaAberta);
  faixaAbertaRef.current = faixaAberta;

  useLayoutEffect(() => {
    if (!faixaAberta && focarReabrir.current) {
      reabrirRef.current?.focus();
      focarReabrir.current = false;
    }
    if (!faixaAberta && !faixaRef.current?.matches(':hover')) {
      ignorarHoverAteSair.current = false;
    }
  }, [faixaAberta]);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (viewportEstreito()) {
        return;
      }
      if (
        faixaAbertaRef.current &&
        !abertaPorHover.current &&
        !ignorarHoverAteSair.current
      ) {
        return;
      }
      const faixa = faixaRef.current;
      const sobreFaixa =
        faixa !== null &&
        event.target instanceof Node &&
        faixa.contains(event.target);
      if (sobreFaixa) {
        if (ignorarHoverAteSair.current) {
          return;
        }
        if (!faixaAbertaRef.current) {
          abertaPorHover.current = true;
          setFaixaAberta(true);
        }
        return;
      }
      ignorarHoverAteSair.current = false;
      if (abertaPorHover.current) {
        abertaPorHover.current = false;
        setFaixaAberta(false);
      }
    }

    document.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => document.removeEventListener('mousemove', onMouseMove);
  }, []);

  if (!perfil) {
    return <Navigate replace to="/login" />;
  }

  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  function fecharPorX() {
    focarReabrir.current = true;
    ignorarHoverAteSair.current = true;
    abertaPorHover.current = false;
    setFaixaAberta(false);
  }

  function abrirPorControle() {
    ignorarHoverAteSair.current = false;
    abertaPorHover.current = false;
    setFaixaAberta(true);
  }

  const marca = (
    <img
      alt=""
      className="sidebar-logo"
      src="/geap_saude_transparente.png"
    />
  );

  return (
    <div
      className={
        faixaAberta ? 'app-shell-auth' : 'app-shell-auth app-shell-auth-collapsed'
      }
    >
      <aside
        ref={faixaRef}
        aria-label="Navegação principal"
        className="app-sidebar"
        id="casca-faixa"
      >
        <div className="sidebar-top">
          {faixaAberta ? (
            <>
              <Link className="sidebar-brand" to="/" aria-label="GEAP, início">
                {marca}
              </Link>
              <button
                aria-controls="casca-faixa"
                aria-expanded
                aria-label={fecharFaixaDeNavegacao}
                className="sidebar-toggle"
                onClick={fecharPorX}
                type="button"
              >
                <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
                  <path
                    d="M3.2 2.2 8 7l4.8-4.8 1 1L9 8l4.8 4.8-1 1L8 9l-4.8 4.8-1-1L7 8 2.2 3.2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </>
          ) : (
            <button
              ref={reabrirRef}
              aria-controls="casca-faixa"
              aria-expanded={false}
              aria-label={abrirFaixaDeNavegacao}
              className="sidebar-reopen"
              onClick={abrirPorControle}
              type="button"
            />
          )}
        </div>

        <nav
          aria-label="Áreas do HQ GEAP"
          className="sidebar-nav"
          hidden={!faixaAberta}
          inert={!faixaAberta}
        >
          {areasPorPapel(perfil.role).map((area) => (
            <NavLink
              key={area.to}
              className={({ isActive }) =>
                isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
              }
              to={area.to}
            >
              {area.label}
            </NavLink>
          ))}
        </nav>

        <div
          className="sidebar-footer"
          hidden={!faixaAberta}
          inert={!faixaAberta}
        >
          <p className="sidebar-user-name">{perfil.name}</p>
          <button className="sidebar-logout" onClick={logout} type="button">
            Sair
          </button>
        </div>
      </aside>

      <div className="app-content">
        <Outlet />
      </div>
    </div>
  );
}
