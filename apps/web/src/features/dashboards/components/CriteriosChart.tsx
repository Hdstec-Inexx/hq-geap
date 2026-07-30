import type { Dashboard } from '@hq-geap/contracts/dashboards';

function formatPercentage(value: number | null) {
  return value === null ? 'Sem amostra' : `${value.toLocaleString('pt-BR')}%`;
}

export function CriteriosChart({
  criterios
}: {
  criterios: Dashboard['criterios'];
}) {
  return (
    <section className="dashboard-panel criterios-panel">
      <header>
        <p className="dashboard-panel-kicker">Régua de Avaliação</p>
        <h2>Acerto por Critério</h2>
        <p>“Não se aplica” fica fora da amostra.</p>
      </header>
      {criterios.length === 0 ? (
        <p className="dashboard-empty">Nenhuma avaliação da IA no período.</p>
      ) : (
        <ol className="criterios-list">
          {criterios.map((criterio) => (
            <li key={criterio.criterioId}>
              <div className="criterio-label">
                <span>{criterio.nome}</span>
                <strong>{formatPercentage(criterio.percentualAcerto)}</strong>
              </div>
              <span className="criterio-track" aria-hidden="true">
                <span style={{ width: `${criterio.percentualAcerto ?? 0}%` }} />
              </span>
              <small>
                {criterio.atendidos} de {criterio.avaliados} avaliados
              </small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
