import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
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
  LinearScale,
  Tooltip
);

function baseOptions(): ChartOptions {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduceMotion ? false : undefined
  };
}

function mergeConfiguration(
  configuration: ChartConfiguration<any>
): ChartConfiguration<any> {
  return {
    ...configuration,
    options: {
      ...baseOptions(),
      ...configuration.options
    }
  };
}

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
  const chartRef = useRef<Chart | null>(null);
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;

  const labels = configuration.data.labels ?? [];
  const dataset = configuration.data.datasets[0];
  const values = Array.isArray(dataset?.data) ? dataset.data : [];
  const dataFingerprint = [
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
    const chart = new Chart(canvas, mergeConfiguration(configurationRef.current));
    chartRef.current = chart;

    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const next = mergeConfiguration(configurationRef.current);
    chart.data = next.data;
    chart.options = next.options ?? {};
    chart.update(baseOptions().animation === false ? 'none' : undefined);
  }, [dataFingerprint]);

  return (
    <canvas
      aria-label={ariaLabel}
      className={className}
      ref={canvasRef}
      role="img"
    />
  );
}
