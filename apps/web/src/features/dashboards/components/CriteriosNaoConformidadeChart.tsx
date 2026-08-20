import type { Dashboard } from '@hq-geap/contracts/dashboards';
import type { ChartConfiguration } from 'chart.js';
import { Link, useNavigate } from 'react-router-dom';
import { criteriosNaoConformidadeChartSeries } from '../chartSeries';
import { motivosColors } from '../chartTheme';
import { detalhamentoListPath } from '../detalhamento';
import { DashboardChart } from './DashboardChart';

export function CriteriosNaoConformidadeChart({
  criterios,
  inicio,
  fim
}: {
  criterios: Dashboard['criteriosNaoConformidade'];
  inicio: string;
  fim: string;
}) {
  const navigate = useNavigate();
  const series = criteriosNaoConformidadeChartSeries(criterios);
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
      cutout: '58%',
      rotation: 0
    }
  };

  return (
    <section className="dashboard-panel criterios-nao-conformidade-panel">
      <header>
        <p className="dashboard-panel-kicker">Distribuição de Falhas</p>
        <h2>Critérios de Não Conformidade</h2>
        <p>Avaliados como não atendidos pela IA no período.</p>
      </header>
      {criterios.length === 0 ? (
        <p className="dashboard-empty">
          Nenhum Critério com Não Conformidade no período.
        </p>
      ) : (
        <div className="motivos-chart-layout">
          <div className="dashboard-chart-frame motivos-chart-frame">
            <DashboardChart
              ariaLabel="Gráfico de Critérios de Não Conformidade"
              configuration={configuration}
              onIndexClick={(index) => {
                const criterio = criterios[index];
                if (!criterio) {
                  return;
                }
                navigate(
                  detalhamentoListPath({
                    inicio,
                    fim,
                    indicador: 'criterio_nao_atendido',
                    criterioId: criterio.criterioId
                  })
                );
              }}
            />
          </div>
          <ul className="motivos-legend">
            {criterios.map((item, index) => {
              const share = total === 0 ? 0 : (item.total / total) * 100;
              return (
                <li key={item.criterioId}>
                  <span
                    className="motivos-swatch"
                    style={{ background: colors[index]! }}
                  />
                  <Link
                    to={detalhamentoListPath({
                      inicio,
                      fim,
                      indicador: 'criterio_nao_atendido',
                      criterioId: item.criterioId
                    })}
                  >
                    {item.nome}
                  </Link>
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
