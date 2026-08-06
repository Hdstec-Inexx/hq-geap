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
  type ChartEvent,
  type ActiveElement,
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
  configuration: ChartConfiguration<any>,
  onIndexClick?: (index: number) => void
): ChartConfiguration<any> {
  return {
    ...configuration,
    options: {
      ...baseOptions(),
      ...configuration.options,
      onClick: (
        _event: ChartEvent,
        elements: ActiveElement[],
        _chart: Chart
      ) => {
        const index = elements[0]?.index;
        if (index !== undefined && onIndexClick) {
          onIndexClick(index);
        }
      }
    }
  };
}

export function DashboardChart({
  ariaLabel,
  className,
  configuration,
  onIndexClick
}: {
  ariaLabel: string;
  className?: string;
  // Chart.js generics for typed chart kinds don't assign cleanly across bar/doughnut.
  configuration: ChartConfiguration<any>;
  onIndexClick?: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const configurationRef = useRef(configuration);
  const onIndexClickRef = useRef(onIndexClick);
  configurationRef.current = configuration;
  onIndexClickRef.current = onIndexClick;

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
    const chart = new Chart(
      canvas,
      mergeConfiguration(configurationRef.current, (index) =>
        onIndexClickRef.current?.(index)
      )
    );
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

    const next = mergeConfiguration(configurationRef.current, (index) =>
      onIndexClickRef.current?.(index)
    );
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
      style={onIndexClick ? { cursor: 'pointer' } : undefined}
    />
  );
}
