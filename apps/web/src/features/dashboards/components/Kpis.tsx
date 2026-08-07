import type { DetalhamentoIndicador } from '@hq-geap/contracts/atendimentos';
import {
  SLA_TME_LIMITE_SEGUNDOS,
  type Dashboard
} from '@hq-geap/contracts/dashboards';
import { Link } from 'react-router-dom';
import { formatDuration } from '../../atendimentos/api';
import { detalhamentoListPath } from '../detalhamento';

function valueOrDash(value: number | null, format: (value: number) => string) {
  return value === null ? '—' : format(value);
}

function formatPercentage(value: number) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function formatNota(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatSlaLimit(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function KpiLink({
  inicio,
  fim,
  indicador,
  label,
  value,
  hint,
  ariaLabel
}: {
  inicio: string;
  fim: string;
  indicador: DetalhamentoIndicador;
  label: string;
  value: string;
  hint?: string;
  ariaLabel: string;
}) {
  return (
    <Link
      aria-label={ariaLabel}
      className="dashboard-kpi-link"
      to={detalhamentoListPath({ inicio, fim, indicador })}
    >
      <article>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </article>
    </Link>
  );
}

export function Kpis({
  kpis,
  inicio,
  fim
}: {
  kpis: Dashboard['kpis'];
  inicio: string;
  fim: string;
}) {
  const notaIaHref = detalhamentoListPath({
    inicio,
    fim,
    indicador: 'nota_media_ia'
  });
  const notaCuradorHref = detalhamentoListPath({
    inicio,
    fim,
    indicador: 'nota_media_curador'
  });

  return (
    <section className="dashboard-kpis" aria-label="Indicadores do período">
      <KpiLink
        ariaLabel="Detalhar Total de Atendimentos"
        fim={fim}
        indicador="volume"
        inicio={inicio}
        label="Total de Atendimentos"
        value={kpis.volume.toLocaleString('pt-BR')}
      />
      <KpiLink
        ariaLabel="Detalhar TMA"
        fim={fim}
        indicador="tma"
        inicio={inicio}
        label="TMA"
        value={valueOrDash(kpis.tmaSegundos, formatDuration)}
      />
      <KpiLink
        ariaLabel="Detalhar TME"
        fim={fim}
        indicador="tme"
        inicio={inicio}
        label="TME"
        value={valueOrDash(kpis.tmeSegundos, formatDuration)}
      />
      <KpiLink
        ariaLabel="Detalhar Taxa de Resolvidas"
        fim={fim}
        indicador="resolvidas"
        inicio={inicio}
        label="Taxa de Resolvidas"
        value={valueOrDash(kpis.taxaResolvidas, formatPercentage)}
      />
      <KpiLink
        ariaLabel="Detalhar SLA"
        fim={fim}
        hint={`meta ${kpis.slaMeta}% · Tempo de Espera ≤ ${formatSlaLimit(SLA_TME_LIMITE_SEGUNDOS)}`}
        indicador="sla"
        inicio={inicio}
        label="SLA"
        value={valueOrDash(kpis.sla, formatPercentage)}
      />
      <article className="dashboard-kpi-nota">
        <span>Nota média</span>
        <strong>
          <Link aria-label="Detalhar Nota média IA" to={notaIaHref}>
            {valueOrDash(kpis.notaMediaIa, formatNota)}
          </Link>
          {' × '}
          <Link aria-label="Detalhar Nota média Curador" to={notaCuradorHref}>
            {valueOrDash(kpis.notaMediaCurador, formatNota)}
          </Link>
        </strong>
        <small>IA × Curador</small>
      </article>
      <KpiLink
        ariaLabel="Detalhar Taxa de Promessas Cumpridas"
        fim={fim}
        indicador="promessas"
        inicio={inicio}
        label="Taxa de Promessas Cumpridas"
        value={valueOrDash(kpis.taxaPromessasCumpridas, formatPercentage)}
      />
      <KpiLink
        ariaLabel="Detalhar Tempo Médio até Resolução"
        fim={fim}
        indicador="tempo_resolucao"
        inicio={inicio}
        label="Tempo Médio até Resolução"
        value={valueOrDash(kpis.tempoMedioAteResolucao, formatDuration)}
      />
    </section>
  );
}
