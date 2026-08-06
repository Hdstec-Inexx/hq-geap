import {
  SLA_TME_LIMITE_SEGUNDOS,
  type Dashboard
} from '@hq-geap/contracts/dashboards';
import { formatDuration } from '../../atendimentos/api';

function valueOrDash(value: number | null, format: (value: number) => string) {
  return value === null ? '—' : format(value);
}

function formatPercentage(value: number) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function formatNota(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatNotaPar(ia: number | null, curador: number | null) {
  if (ia === null && curador === null) {
    return '—';
  }
  return `${valueOrDash(ia, formatNota)} × ${valueOrDash(curador, formatNota)}`;
}

function formatSlaLimit(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function Kpis({ kpis }: { kpis: Dashboard['kpis'] }) {
  const items = [
    {
      label: 'Total de Atendimentos',
      value: kpis.volume.toLocaleString('pt-BR')
    },
    {
      label: 'TMA',
      value: valueOrDash(kpis.tmaSegundos, formatDuration)
    },
    {
      label: 'TME',
      value: valueOrDash(kpis.tmeSegundos, formatDuration)
    },
    {
      label: 'Taxa de Resolvidas',
      value: valueOrDash(kpis.taxaResolvidas, formatPercentage)
    },
    {
      label: 'SLA',
      value: valueOrDash(kpis.sla, formatPercentage),
      hint: `meta ${kpis.slaMeta}% · TME ≤ ${formatSlaLimit(SLA_TME_LIMITE_SEGUNDOS)}`
    },
    {
      label: 'Nota média',
      value: formatNotaPar(kpis.notaMediaIa, kpis.notaMediaCurador),
      hint: 'IA × Curador'
    },
    {
      label: 'Taxa de Promessas Cumpridas',
      value: valueOrDash(kpis.taxaPromessasCumpridas, formatPercentage)
    },
    {
      label: 'Tempo Médio até Resolução',
      value: valueOrDash(kpis.tempoMedioAteResolucao, formatDuration)
    }
  ];

  return (
    <section className="dashboard-kpis" aria-label="Indicadores do período">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {'hint' in item && item.hint ? <small>{item.hint}</small> : null}
        </article>
      ))}
    </section>
  );
}
