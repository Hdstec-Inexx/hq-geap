import type { UserRole } from '@hq-geap/contracts/auth';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePerfil } from '../features/auth/perfil-context';
import { clearSession } from '../features/auth/session';

type NavItem = {
  to: string;
  label: string;
};

function navItemsFor(role: UserRole): NavItem[] {
  const items: NavItem[] = [];

  if (role !== 'curador') {
    items.push({ to: '/dashboard', label: 'Abrir Dashboard da Gestão' });
  }

  items.push(
    { to: '/atendimentos', label: 'Consultar Atendimentos' },
    { to: '/monitoramento', label: 'Monitoramento ao Vivo' },
    {
      to: '/curadoria',
      label:
        role === 'gestao' ? 'Consultar Fila de Curadoria' : 'Abrir Fila de Curadoria'
    }
  );

  if (role === 'admin') {
    items.push(
      { to: '/admin/comentarios', label: 'Trabalhar fila de manutenção' },
      { to: '/admin/usuarios', label: 'Administrar usuários' },
      { to: '/admin/configuracao-ia', label: 'Configurar IA Avaliadora' },
      { to: '/admin/criterios', label: 'Consultar Régua de Avaliação' }
    );
  }

  return items;
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

  if (!perfil) {
    return null;
  }

  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell-auth">
      <aside className="app-sidebar" aria-label="Navegação principal">
        <Link className="sidebar-brand" to="/" aria-label="GEAP, início">
          <img
            alt=""
            className="sidebar-logo"
            src="/geap_saude_transparente.png"
          />
        </Link>

        <nav className="sidebar-nav" aria-label="Áreas do HQ GEAP">
          {navItemsFor(perfil.role).map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
              }
              to={item.to}
            >
              {item.label}
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
