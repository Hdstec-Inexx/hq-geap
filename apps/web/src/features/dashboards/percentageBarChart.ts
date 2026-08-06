import type { ChartConfiguration, ChartOptions } from 'chart.js';
import type { ChartSeries } from './chartSeries';

export function percentageBarConfiguration(
  series: ChartSeries,
  colors: {
    bar: string;
    tick: string;
    label: string;
    grid: string;
  }
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: series.labels,
      datasets: [
        {
          data: series.values,
          backgroundColor: colors.bar,
          borderWidth: 0,
          borderRadius: 2
        }
      ]
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: (value) => `${value}%`,
            color: colors.tick
          },
          grid: { color: colors.grid }
        },
        y: {
          ticks: { color: colors.label },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed.x;
              return value === null ? 'Sem amostra' : `${value}%`;
            }
          }
        }
      }
    } satisfies ChartOptions<'bar'>
  };
}
