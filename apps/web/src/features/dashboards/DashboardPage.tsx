import { dashboardSchema } from '@hq-geap/contracts/dashboards';
import { useEffect, useState } from 'react';
import { Form, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthenticatedResource } from '../atendimentos/api';
import { formatMotivoContato } from '../atendimentos/motivo-combobox-logic';
import { ConcordanciaChart } from './components/ConcordanciaChart';
import { CriteriosChart } from './components/CriteriosChart';
import { CriteriosNaoConformidadeChart } from './components/CriteriosNaoConformidadeChart';
import { Kpis } from './components/Kpis';
import { MotivosContatoChart } from './components/MotivosContatoChart';

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultPeriod() {
  const today = new Date();
  return {
    inicio: dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    fim: dateInputValue(today)
  };
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
});

export function DashboardPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = defaultPeriod();
  const inicioParam = searchParams.get('inicio');
  const fimParam = searchParams.get('fim');
  const inicio = inicioParam ?? fallback.inicio;
  const fim = fimParam ?? fallback.fim;

  const [draftInicio, setDraftInicio] = useState(inicio);
  const [draftFim, setDraftFim] = useState(fim);

  useEffect(() => {
    setDraftInicio(inicio);
    setDraftFim(fim);
  }, [inicio, fim]);

  const hasCustomPeriod = Boolean(
    inicioParam ||
      fimParam ||
      draftInicio !== fallback.inicio ||
      draftFim !== fallback.fim
  );

  const state = useAuthenticatedResource(
    `/dashboards/gestao?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`,
    dashboardSchema
  );

  function handleClearPeriod() {
    setDraftInicio(fallback.inicio);
    setDraftFim(fallback.fim);
    setSearchParams({});
  }

  return (
    <main className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <p className="eyebrow">Gestão / leitura gerencial</p>
          <h1>Pulso da operação</h1>
          <p>
            Volume, espera, resolução e qualidade sob a mesma janela de observação.
          </p>
        </div>
        <Form className="period-filter" method="get">
          <label>
            Início
            <input
              name="inicio"
              onChange={(e) => setDraftInicio(e.target.value)}
              type="date"
              value={draftInicio}
            />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            Fim
            <input
              name="fim"
              onChange={(e) => setDraftFim(e.target.value)}
              type="date"
              value={draftFim}
            />
          </label>
          <div className="period-filter-actions">
            <button className="period-filter-submit" type="submit">
              Aplicar período
            </button>
            {hasCustomPeriod ? (
              <button
                className="period-filter-clear"
                onClick={handleClearPeriod}
                type="button"
              >
                Limpar período
              </button>
            ) : null}
          </div>
        </Form>
      </header>

      {state.status === 'loading' ? (
        <div className="dashboard-loading" aria-label="Carregando dashboard">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <section className="dashboard-error">
          <h2>O período não pôde ser analisado</h2>
          <p>Confira as datas e tente novamente.</p>
        </section>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <Kpis fim={fim} inicio={inicio} kpis={state.data.kpis} />
          <div className="dashboard-grid">
            <MotivosContatoChart
              fim={fim}
              inicio={inicio}
              motivos={state.data.motivosContato}
            />
            <CriteriosChart
              criterios={state.data.criterios}
              fim={fim}
              inicio={inicio}
            />
            <ConcordanciaChart
              concordancia={state.data.concordancia}
              fim={fim}
              inicio={inicio}
            />
            <CriteriosNaoConformidadeChart
              criterios={state.data.criteriosNaoConformidade}
              fim={fim}
              inicio={inicio}
            />
            <section className="dashboard-panel piores-panel">
              <header>
                <p className="dashboard-panel-kicker">Prioridade de análise</p>
                <h2>Piores Atendimentos</h2>
                <p>Ordenados pela nota da IA Avaliadora.</p>
              </header>
              {state.data.pioresAtendimentos.length === 0 ? (
                <p className="dashboard-empty">
                  Nenhum Atendimento avaliado no período.
                </p>
              ) : (
                <ol>
                  {state.data.pioresAtendimentos.map((atendimento) => {
                    const fromUrl = `${location.pathname}${location.search}`;
                    return (
                      <li key={atendimento.id}>
                        <strong
                          aria-label={`Nota IA ${atendimento.notaIa.toLocaleString('pt-BR')}`}
                        >
                          {atendimento.notaIa.toLocaleString('pt-BR')}
                        </strong>
                        <div>
                          <Link
                            to={`/atendimentos/${atendimento.id}?from=${encodeURIComponent(fromUrl)}`}
                          >
                            {formatMotivoContato(atendimento.motivoContato)}
                          </Link>
                          <span>
                            {dateTime.format(new Date(atendimento.concluidoEm))}
                            {' · '}
                            Curador{' '}
                            {atendimento.notaCurador?.toLocaleString('pt-BR') ?? '—'}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
