import type { Dashboard } from '@hq-geap/contracts/dashboards';

export function MotivosContatoChart({
  motivos
}: {
  motivos: Dashboard['motivosContato'];
}) {
  const maximum = Math.max(...motivos.map(({ total }) => total), 1);

  return (
    <section className="dashboard-panel motivos-panel">
      <header>
        <p className="dashboard-panel-kicker">Distribuição</p>
        <h2>Motivos de Contato</h2>
      </header>
      {motivos.length === 0 ? (
        <p className="dashboard-empty">Nenhum Motivo de Contato no período.</p>
      ) : (
        <ol className="dashboard-bars">
          {motivos.map(({ motivo, total }) => (
            <li key={motivo}>
              <div>
                <span>{motivo}</span>
                <strong>{total.toLocaleString('pt-BR')}</strong>
              </div>
              <span className="dashboard-bar-track" aria-hidden="true">
                <span style={{ width: `${(total / maximum) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
