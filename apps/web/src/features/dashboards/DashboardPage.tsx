import { dashboardSchema } from '@hq-geap/contracts/dashboards';
import { Form, Link, useSearchParams } from 'react-router-dom';
import { useAuthenticatedResource } from '../atendimentos/api';
import { ConcordanciaChart } from './components/ConcordanciaChart';
import { CriteriosChart } from './components/CriteriosChart';
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
  const [searchParams] = useSearchParams();
  const fallback = defaultPeriod();
  const inicio = searchParams.get('inicio') ?? fallback.inicio;
  const fim = searchParams.get('fim') ?? fallback.fim;
  const state = useAuthenticatedResource(
    `/dashboards/gestao?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`,
    dashboardSchema
  );

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
            <input defaultValue={inicio} key={`inicio-${inicio}`} name="inicio" type="date" />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            Fim
            <input defaultValue={fim} key={`fim-${fim}`} name="fim" type="date" />
          </label>
          <button type="submit">Aplicar período</button>
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
                  {state.data.pioresAtendimentos.map((atendimento) => (
                    <li key={atendimento.id}>
                      <strong
                        aria-label={`Nota IA ${atendimento.notaIa.toLocaleString('pt-BR')}`}
                      >
                        {atendimento.notaIa.toLocaleString('pt-BR')}
                      </strong>
                      <div>
                        <Link to={`/atendimentos/${atendimento.id}`}>
                          {atendimento.motivoContato ?? 'Motivo não informado'}
                        </Link>
                        <span>
                          {dateTime.format(new Date(atendimento.concluidoEm))}
                          {' · '}
                          Curador{' '}
                          {atendimento.notaCurador?.toLocaleString('pt-BR') ?? '—'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
