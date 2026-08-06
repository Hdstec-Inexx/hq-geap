import type { Dashboard } from '@hq-geap/contracts/dashboards';
import { Link, useNavigate } from 'react-router-dom';
import { concordanciaChartSeries } from '../chartSeries';
import { detalhamentoListPath } from '../detalhamento';
import { percentageBarConfiguration } from '../percentageBarChart';
import { DashboardChart } from './DashboardChart';

function percentage(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('pt-BR')}%`;
}

export function ConcordanciaChart({
  concordancia,
  inicio,
  fim
}: {
  concordancia: Dashboard['concordancia'];
  inicio: string;
  fim: string;
}) {
  const navigate = useNavigate();
  const series = concordanciaChartSeries(concordancia.porCriterio);
  const notaHref = detalhamentoListPath({
    inicio,
    fim,
    indicador: 'concordancia_nota'
  });

  return (
    <section className="dashboard-panel concordancia-panel">
      <header>
        <p className="dashboard-panel-kicker">Calibração IA × Curador</p>
        <h2>Concordância</h2>
      </header>
      <div className="concordancia-summary">
        <Link aria-label="Detalhar Concordância por nota" to={notaHref}>
          <article>
            <span>Nota exata</span>
            <strong>{percentage(concordancia.nota.percentual)}</strong>
            <small>
              {concordancia.nota.concordantes} de {concordancia.nota.total}
            </small>
          </article>
        </Link>
        <article>
          <span>Estado dos Critérios</span>
          <strong>{percentage(concordancia.criterios.percentual)}</strong>
          <small>
            {concordancia.criterios.concordantes} de {concordancia.criterios.total}
          </small>
        </article>
      </div>
      {concordancia.porCriterio.length === 0 ? (
        <p className="dashboard-empty">Nenhuma Concordância por Critério no período.</p>
      ) : (
        <div className="dashboard-chart-frame concordancia-chart-frame">
          <DashboardChart
            ariaLabel="Gráfico de Concordância por Critério"
            configuration={percentageBarConfiguration(series, {
              bar: '#62d4b6',
              tick: '#b9d1ca',
              label: '#eff9f5',
              grid: 'rgb(239 249 245 / 12%)'
            })}
            onIndexClick={(index) => {
              const item = concordancia.porCriterio[index];
              if (!item) {
                return;
              }
              navigate(
                detalhamentoListPath({
                  inicio,
                  fim,
                  indicador: 'concordancia_criterio',
                  criterioId: item.criterioId
                })
              );
            }}
          />
        </div>
      )}
    </section>
  );
}
