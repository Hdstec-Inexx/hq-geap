import type { Dashboard } from '@hq-geap/contracts/dashboards';
import type { ChartConfiguration } from 'chart.js';
import { motivosChartSeries } from '../chartSeries';
import { motivosColors } from '../chartTheme';
import { DashboardChart } from './DashboardChart';

export function MotivosContatoChart({
  motivos
}: {
  motivos: Dashboard['motivosContato'];
}) {
  const series = motivosChartSeries(motivos);
  const colors = motivosColors(series.values.length);
  const total = series.values.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0
  );
  const values = series.values.map((value) => value ?? 0);
  const configuration: ChartConfiguration<'doughnut'> = {
    type: 'doughnut',
    data: {
      labels: series.labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 0
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: false }
      },
      cutout: '58%'
    }
  };

  return (
    <section className="dashboard-panel motivos-panel">
      <header>
        <p className="dashboard-panel-kicker">Distribuição</p>
        <h2>Motivos de Contato</h2>
      </header>
      {motivos.length === 0 ? (
        <p className="dashboard-empty">Nenhum Motivo de Contato no período.</p>
      ) : (
        <div className="motivos-chart-layout">
          <div className="dashboard-chart-frame motivos-chart-frame">
            <DashboardChart
              ariaLabel="Gráfico de Motivos de Contato"
              configuration={configuration}
            />
          </div>
          <ul className="motivos-legend">
            {motivos.map((item, index) => {
              const share = total === 0 ? 0 : (item.total / total) * 100;
              return (
                <li key={item.motivo}>
                  <span
                    className="motivos-swatch"
                    style={{ background: colors[index]! }}
                  />
                  <span>{item.motivo}</span>
                  <strong>
                    {item.total.toLocaleString('pt-BR')} ({share.toFixed(0)}%)
                  </strong>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
