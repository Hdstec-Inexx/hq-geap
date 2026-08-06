import type { Dashboard } from '@hq-geap/contracts/dashboards';
import { criteriosChartSeries } from '../chartSeries';
import { percentageBarConfiguration } from '../percentageBarChart';
import { DashboardChart } from './DashboardChart';

function formatPercentage(value: number | null) {
  return value === null ? 'Sem amostra' : `${value.toLocaleString('pt-BR')}%`;
}

export function CriteriosChart({
  criterios
}: {
  criterios: Dashboard['criterios'];
}) {
  const series = criteriosChartSeries(criterios);

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
        <>
          <div className="dashboard-chart-frame criterios-chart-frame">
            <DashboardChart
              ariaLabel="Gráfico de acerto por Critério"
              configuration={percentageBarConfiguration(series, {
                bar: '#123b4a',
                tick: '#5d777e',
                label: '#123b4a',
                grid: 'rgb(18 59 74 / 12%)'
              })}
            />
          </div>
          <ol className="criterios-list">
            {criterios.map((criterio) => (
              <li key={criterio.criterioId}>
                <div className="criterio-label">
                  <span>{criterio.nome}</span>
                  <strong>{formatPercentage(criterio.percentualAcerto)}</strong>
                </div>
                <small>
                  {criterio.atendidos} de {criterio.avaliados} avaliados
                </small>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
