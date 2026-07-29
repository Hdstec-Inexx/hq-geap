import { healthResponseSchema } from '@hq-geap/contracts/health';
import { useEffect, useState } from 'react';

type HealthState = 'loading' | 'ready' | 'error';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function HealthPage() {
  const [state, setState] = useState<HealthState>('loading');

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health request failed with ${response.status}`);
        }
        return healthResponseSchema.parse(await response.json());
      })
      .then(() => setState('ready'))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('error');
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="health-page" aria-live="polite">
      <div className="health-copy">
        <p className="eyebrow">Fundação do sistema</p>
        {state === 'ready' ? (
          <h1>HQ GEAP está operacional</h1>
        ) : state === 'error' ? (
          <h1>Não foi possível confirmar o ambiente</h1>
        ) : (
          <h1>Verificando o ambiente</h1>
        )}
        <p className="summary">
          O ponto de partida para acompanhar a qualidade dos Atendimentos da
          Lívia, da ingestão à curadoria humana.
        </p>
      </div>

      <div className={`status-card status-${state}`}>
        <div className="signal" aria-hidden="true">
          {[18, 34, 52, 27, 46, 62, 39, 22, 48, 31].map((height, index) => (
            <span key={index} style={{ height }} />
          ))}
        </div>
        <div className="status-line">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>
              {state === 'ready'
                ? 'API e banco operacionais'
                : state === 'error'
                  ? 'API ou banco indisponível'
                  : 'Consultando API e banco'}
            </strong>
            <span>Verificação pela fronteira HTTP</span>
          </div>
        </div>
      </div>
    </section>
  );
}
