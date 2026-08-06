import type { Dashboard } from '@hq-geap/contracts/dashboards';
import { Link, useNavigate } from 'react-router-dom';
import { criteriosChartSeries } from '../chartSeries';
import { detalhamentoListPath } from '../detalhamento';
import { percentageBarConfiguration } from '../percentageBarChart';
import { DashboardChart } from './DashboardChart';

function formatPercentage(value: number | null) {
  return value === null ? 'Sem amostra' : `${value.toLocaleString('pt-BR')}%`;
}

export function CriteriosChart({
  criterios,
  inicio,
  fim
}: {
  criterios: Dashboard['criterios'];
  inicio: string;
  fim: string;
}) {
  const navigate = useNavigate();
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
              onIndexClick={(index) => {
                const criterio = criterios[index];
                if (!criterio) {
                  return;
                }
                navigate(
                  detalhamentoListPath({
                    inicio,
                    fim,
                    indicador: 'criterio',
                    criterioId: criterio.criterioId
                  })
                );
              }}
            />
          </div>
          <ol className="criterios-list">
            {criterios.map((criterio) => (
              <li key={criterio.criterioId}>
                <div className="criterio-label">
                  <Link
                    to={detalhamentoListPath({
                      inicio,
                      fim,
                      indicador: 'criterio',
                      criterioId: criterio.criterioId
                    })}
                  >
                    {criterio.nome}
                  </Link>
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
