import {
  configuracaoIaSchema,
  type ConfiguracaoIa,
  type PublishConfiguracaoIa
} from '@hq-geap/contracts/configuracao-ia';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, getSession } from '../../auth/session';

type PageState = 'loading' | 'ready' | 'submitting' | 'published' | 'error';

export function ConfiguracaoIaPage() {
  const [configuration, setConfiguration] = useState<ConfiguracaoIa | null>(null);
  const [draft, setDraft] = useState<PublishConfiguracaoIa | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const token = getSession()!.token;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/admin/configuracao-ia`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Configuration request failed with ${response.status}`);
        }
        return configuracaoIaSchema.parse(await response.json());
      })
      .then((active) => {
        setConfiguration(active);
        setDraft(active);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('error');
        }
      });

    return () => controller.abort();
  }, [token]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setState('submitting');

    try {
      const response = await fetch(`${apiUrl}/admin/configuracao-ia`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(draft)
      });
      if (!response.ok) {
        throw new Error(`Publication request failed with ${response.status}`);
      }
      const published = configuracaoIaSchema.parse(await response.json());
      setConfiguration(published);
      setDraft(published);
      setState('published');
    } catch {
      setState('error');
    }
  }

  if (!configuration || !draft) {
    return (
      <section className="configuration-page">
        <p className="eyebrow">Administração / IA Avaliadora</p>
        <h1>Configuração da IA Avaliadora</h1>
        <Link className="back-link" to="/">
          Voltar ao início
        </Link>
        <p className={state === 'error' ? 'configuration-error' : 'session-check'}>
          {state === 'error'
            ? 'Não foi possível carregar a configuração ativa.'
            : 'Carregando configuração ativa...'}
        </p>
      </section>
    );
  }

  return (
    <section className="configuration-page">
      <header className="configuration-heading">
        <div>
          <p className="eyebrow">Administração / IA Avaliadora</p>
          <h1>Configuração da IA Avaliadora</h1>
          <Link className="back-link" to="/">
            Voltar ao início
          </Link>
        </div>
        <div className="version-badge">
          <span>Versão ativa {configuration.version}</span>
          <strong>{configuration.model}</strong>
        </div>
      </header>

      <form className="configuration-form" onSubmit={publish}>
        <label className="prompt-field">
          <span>Prompt</span>
          <textarea
            name="prompt"
            onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
            required
            rows={16}
            value={draft.prompt}
          />
        </label>

        <div className="configuration-fields">
          <label>
            <span>Provedor</span>
            <input
              name="provider"
              onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
              required
              value={draft.provider}
            />
          </label>
          <label>
            <span>Modelo</span>
            <input
              name="model"
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              required
              value={draft.model}
            />
          </label>
          <label>
            <span>Temperatura</span>
            <input
              max="2"
              min="0"
              name="temperature"
              onChange={(event) =>
                setDraft({ ...draft, temperature: event.target.valueAsNumber })
              }
              required
              step="0.1"
              type="number"
              value={draft.temperature}
            />
          </label>
        </div>

        <div className="publication-bar">
          <p>
            A publicação preserva esta versão e ativa uma nova configuração de
            forma atômica.
          </p>
          <button disabled={state === 'submitting'} type="submit">
            {state === 'submitting' ? 'Publicando...' : 'Publicar nova versão'}
          </button>
        </div>
        {state === 'published' ? (
          <p className="configuration-success" role="status">
            Nova versão publicada e disponibilizada ao n8n.
          </p>
        ) : null}
        {state === 'error' ? (
          <p className="configuration-error" role="alert">
            Não foi possível publicar. A configuração anterior permanece ativa.
          </p>
        ) : null}
      </form>
    </section>
  );
}
