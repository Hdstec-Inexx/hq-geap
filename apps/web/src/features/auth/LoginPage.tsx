import { loginResponseSchema } from '@hq-geap/contracts/auth';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  apiUrl,
  fetchPerfil,
  getPerfil,
  getSession,
  markPerfilValidatedAt,
  savePerfil,
  saveSession
} from './session';

type LoginState = 'idle' | 'submitting' | 'invalid' | 'unavailable';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<LoginState>('idle');
  const [showPassword, setShowPassword] = useState(false);

  if (getSession() && getPerfil()) {
    return <Navigate replace to="/" />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password')
        })
      });
      if (response.status === 401) {
        setState('invalid');
        return;
      }
      if (!response.ok) {
        throw new Error(`Login request failed with ${response.status}`);
      }

      const session = loginResponseSchema.parse(await response.json());
      const perfil = await fetchPerfil(session.token);
      saveSession(session);
      savePerfil(perfil);
      markPerfilValidatedAt();
      const returnTo = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(returnTo, { replace: true });
    } catch {
      setState('unavailable');
    }
  }

  return (
    <section className="login-page">
      <div className="login-intro">
        <p className="eyebrow">Acesso à operação</p>
        <h1>Acesse o HQ GEAP</h1>
        <p className="summary">
          Entre para acompanhar a qualidade dos Atendimentos conforme as
          responsabilidades do seu papel.
        </p>
        <div className="role-track" aria-label="Papéis com acesso">
          <span>Admin</span>
          <span>Gestão</span>
          <span>Curador</span>
        </div>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <p className="form-kicker">Credenciais</p>
          <h2>Identifique-se</h2>
        </div>

        <label htmlFor="login-email">
          <span>E-mail</span>
          <input
            autoComplete="username"
            id="login-email"
            name="email"
            placeholder="nome@empresa.com.br"
            required
            type="email"
          />
        </label>

        <div className="password-field">
          <label htmlFor="login-password">
            <span>Senha</span>
            <input
              autoComplete="current-password"
              id="login-password"
              name="password"
              required
              type={showPassword ? 'text' : 'password'}
            />
          </label>
          <button
            aria-controls="login-password"
            aria-pressed={showPassword}
            className="password-toggle"
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          </button>
        </div>

        {state === 'invalid' ? (
          <p className="form-error" role="alert">
            E-mail ou senha inválidos. Verifique os dados e tente novamente.
          </p>
        ) : null}

        {state === 'unavailable' ? (
          <p className="form-error" role="alert">
            Não foi possível entrar agora. Tente novamente em instantes.
          </p>
        ) : null}

        <button disabled={state === 'submitting'} type="submit">
          {state === 'submitting' ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </section>
  );
}
