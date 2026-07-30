import type { Dashboard } from '@hq-geap/contracts/dashboards';
import { formatDuration } from '../../atendimentos/api';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD'
});

function valueOrDash(value: number | null, format: (value: number) => string) {
  return value === null ? '—' : format(value);
}

export function Kpis({ kpis }: { kpis: Dashboard['kpis'] }) {
  const items = [
    { label: 'Volume', value: kpis.volume.toLocaleString('pt-BR') },
    {
      label: 'TMA',
      value: valueOrDash(kpis.tmaSegundos, formatDuration)
    },
    {
      label: 'Nota IA',
      value: valueOrDash(kpis.notaMediaIa, (value) =>
        value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
      )
    },
    {
      label: 'Nota Curador',
      value: valueOrDash(kpis.notaMediaCurador, (value) =>
        value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
      )
    },
    {
      label: 'Transferências',
      value: kpis.transferencias.toLocaleString('pt-BR')
    },
    {
      label: 'Resolvidos sem transferência',
      value: kpis.resolvidosSemTransferencia.toLocaleString('pt-BR')
    },
    {
      label: 'Custo total',
      value: valueOrDash(kpis.custoTotal, currency.format)
    },
    {
      label: 'Custo médio',
      value: valueOrDash(kpis.custoMedio, currency.format)
    }
  ];

  return (
    <section className="dashboard-kpis" aria-label="Indicadores do período">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  );
}
