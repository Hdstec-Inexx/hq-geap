import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { usePerfil } from '../features/auth/perfil-context';
import { clearSession } from '../features/auth/session';
import { areasPorPapel } from './casca-areas';
import {
  abrirFaixaDeNavegacao,
  fecharFaixaDeNavegacao
} from './casca-faixa';

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

  if (!perfil) {
    return <Navigate replace to="/login" />;
  }

  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <div
      className={
        faixaAberta ? 'app-shell-auth' : 'app-shell-auth app-shell-auth-collapsed'
      }
    >
      <button
        aria-controls="casca-faixa"
        aria-expanded={faixaAberta}
        aria-label={
          faixaAberta ? fecharFaixaDeNavegacao : abrirFaixaDeNavegacao
        }
        className="sidebar-toggle"
        onClick={() => setFaixaAberta((aberta) => !aberta)}
        type="button"
      >
        {faixaAberta ? 'Fechar' : 'Abrir'}
      </button>

      <aside
        aria-label="Navegação principal"
        className="app-sidebar"
        hidden={!faixaAberta}
        id="casca-faixa"
        inert={!faixaAberta}
      >
        <Link className="sidebar-brand" to="/" aria-label="GEAP, início">
          <img
            alt=""
            className="sidebar-logo"
            src="/geap_saude_transparente.png"
          />
        </Link>

        <nav className="sidebar-nav" aria-label="Áreas do HQ GEAP">
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

        <div className="sidebar-footer">
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
