import type { Dashboard } from '@hq-geap/contracts/dashboards';

function percentage(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('pt-BR')}%`;
}

export function ConcordanciaChart({
  concordancia
}: {
  concordancia: Dashboard['concordancia'];
}) {
  return (
    <section className="dashboard-panel concordancia-panel">
      <header>
        <p className="dashboard-panel-kicker">Calibração IA × Curador</p>
        <h2>Concordância</h2>
      </header>
      <div className="concordancia-summary">
        <article>
          <span>Nota exata</span>
          <strong>{percentage(concordancia.nota.percentual)}</strong>
          <small>
            {concordancia.nota.concordantes} de {concordancia.nota.total}
          </small>
        </article>
        <article>
          <span>Estado dos Critérios</span>
          <strong>{percentage(concordancia.criterios.percentual)}</strong>
          <small>
            {concordancia.criterios.concordantes} de {concordancia.criterios.total}
          </small>
        </article>
      </div>
      <ol className="concordancia-list">
        {concordancia.porCriterio.map((criterio) => (
          <li key={criterio.criterioId}>
            <span>{criterio.nome}</span>
            <span className="concordancia-dots" aria-hidden="true">
              {Array.from({ length: 10 }, (_, index) => (
                <i
                  className={
                    index < Math.round((criterio.percentual ?? 0) / 10)
                      ? 'filled'
                      : ''
                  }
                  key={index}
                />
              ))}
            </span>
            <strong>{percentage(criterio.percentual)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
