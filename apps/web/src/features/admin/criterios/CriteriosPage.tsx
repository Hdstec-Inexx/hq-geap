import {
  reguaAvaliacaoSchema,
  type ReguaAvaliacao
} from '@hq-geap/contracts/criterios';
import { useEffect, useState } from 'react';
import { apiUrl, getSession } from '../../auth/session';

type PageState = 'loading' | 'ready' | 'error';

const pointsFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2
});

export function CriteriosPage() {
  const [regua, setRegua] = useState<ReguaAvaliacao | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const token = getSession()!.token;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/admin/criterios`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Evaluation ruler request failed with ${response.status}`);
        }
        return reguaAvaliacaoSchema.parse(await response.json());
      })
      .then((currentRegua) => {
        setRegua(currentRegua);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('error');
        }
      });

    return () => controller.abort();
  }, [token]);

  if (state !== 'ready' || !regua) {
    return (
      <section className="criteria-page">
        <p className="eyebrow">Administração / Qualidade</p>
        <h1>Régua de Avaliação</h1>
        <p className={state === 'error' ? 'criteria-error' : 'session-check'}>
          {state === 'error'
            ? 'Não foi possível carregar a Régua vigente.'
            : 'Carregando Régua vigente...'}
        </p>
      </section>
    );
  }

  return (
    <section className="criteria-page">
      <header className="criteria-heading">
        <div>
          <p className="eyebrow">Administração / Qualidade</p>
          <h1>Régua de Avaliação</h1>
          <p className="criteria-summary">
            Definição vigente e somente leitura dos critérios usados nas
            Avaliações.
          </p>
        </div>
        <div className="ruler-total" aria-label="Pontuação total da Régua">
          <span>Régua vigente</span>
          <strong>{pointsFormatter.format(regua.total)} pontos</strong>
          <small>Aprovação a partir de {pointsFormatter.format(regua.limiarAprovacao)}</small>
        </div>
      </header>

      <ol className="criteria-list">
        {regua.criterios.map((criterio) => (
          <li data-testid="criterio-regua" key={criterio.chave}>
            <span className="criterion-order">
              {String(criterio.ordem).padStart(2, '0')}
            </span>
            <div className="criterion-content">
              <div className="criterion-title">
                <h2>{criterio.nome}</h2>
                <strong>{pointsFormatter.format(criterio.valor)} pt</strong>
              </div>
              <p>{criterio.descricao ?? 'Sem descrição.'}</p>
              <div className="criterion-tags">
                {criterio.critico ? (
                  <span className="critical-tag">Crítico</span>
                ) : (
                  <span>Não crítico</span>
                )}
                {criterio.condicional ? <span>Condicional</span> : null}
                {!criterio.condicional ? <span>Aplicação obrigatória</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="criteria-footnote">
        Alterações exigem uma nova Régua válida por código e preservam os
        snapshots de Avaliações anteriores.
      </p>
    </section>
  );
}
