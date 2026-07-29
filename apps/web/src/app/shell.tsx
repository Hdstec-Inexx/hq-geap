import { Outlet } from 'react-router-dom';

export function Shell() {
  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="brand" href="/health" aria-label="HQ GEAP, início">
          <span className="brand-mark" aria-hidden="true">
            HQ
          </span>
          <span>Qualidade de atendimento</span>
        </a>
        <span className="environment">Ambiente local</span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
