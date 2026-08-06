import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
  type ChartOptions
} from 'chart.js';
import { useEffect, useRef } from 'react';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip
);

const defaultOptions: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false
};

export function DashboardChart({
  ariaLabel,
  className,
  configuration
}: {
  ariaLabel: string;
  className?: string;
  // Chart.js generics for typed chart kinds don't assign cleanly across bar/doughnut.
  configuration: ChartConfiguration<any>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;

  const labels = configuration.data.labels ?? [];
  const dataset = configuration.data.datasets[0];
  const values = Array.isArray(dataset?.data) ? dataset.data : [];
  const syncKey = [
    configuration.type,
    labels.join('\u0001'),
    values.join('\u0001'),
    JSON.stringify(dataset?.backgroundColor ?? null)
  ].join('|');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    Chart.getChart(canvas)?.destroy();

    const chart = new Chart(canvas, {
      ...configurationRef.current,
      options: {
        ...defaultOptions,
        ...configurationRef.current.options
      }
    } as never);

    return () => {
      chart.destroy();
    };
  }, [syncKey]);

  return (
    <canvas
      aria-label={ariaLabel}
      className={className}
      ref={canvasRef}
      role="img"
    />
  );
}
