import {
  listUsuariosResponseSchema,
  usuarioSchema,
  type CreateUsuario,
  type UpdateUsuario,
  type Usuario
} from '@hq-geap/contracts/usuarios';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { apiUrl, clearSession, getSession } from '../../auth/session';
import { usePerfil } from '../../auth/perfil-context';

const roleNames = {
  admin: 'Admin',
  gestao: 'Gestão',
  curador: 'Curador'
} as const;

type Editor =
  | { mode: 'create'; user: CreateUsuario }
  | { mode: 'edit'; id: string; user: UpdateUsuario }
  | { mode: 'password'; id: string; name: string; password: string };

const emptyUser: CreateUsuario = {
  name: '',
  email: '',
  password: '',
  role: 'curador'
};

const pageSize = 20;

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isRevokedSession(error: unknown) {
  return error instanceof RequestError && error.status === 401;
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  required = false
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="password-field user-password-field">
      <label htmlFor={id}>
        <span>{label}</span>
        <input
          id={id}
          minLength={8}
          required={required}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        aria-controls={id}
        aria-pressed={showPassword}
        className="password-toggle"
        onClick={() => setShowPassword((current) => !current)}
        type="button"
      >
        {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
      </button>
    </div>
  );
}

export function UsuariosPage() {
  const [users, setUsers] = useState<Usuario[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session] = useState(() => getSession()!);
  const perfil = usePerfil();
  const token = session.token;
  const navigate = useNavigate();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function requireSuccessfulResponse(response: Response) {
    // 401 = sessão inválida/expirada. 403 = papel insuficiente — o gate de
    // RequireRole reage ao refresh de Perfil; não tratar como logout.
    if (response.status === 401) {
      clearSession();
      navigate('/login', { replace: true });
      throw new RequestError(response.status, 'Session revoked');
    }
    if (response.status === 403) {
      throw new RequestError(response.status, 'Forbidden');
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new RequestError(response.status, body?.message ?? 'Request failed');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${apiUrl}/admin/usuarios?page=${page}&pageSize=${pageSize}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        await requireSuccessfulResponse(response);
        return listUsuariosResponseSchema.parse(await response.json());
      })
      .then((result) => {
        setUsers(result.users);
        setTotal(result.total);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          if (!isRevokedSession(requestError)) {
            setError('Não foi possível carregar os usuários.');
          }
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [navigate, page, revision, token]);

  function edit(user: Usuario) {
    setError(null);
    setEditor({
      mode: 'edit',
      id: user.id,
      user: { name: user.name, email: user.email, role: user.role }
    });
  }

  function setPassword(user: Usuario) {
    setError(null);
    setEditor({
      mode: 'password',
      id: user.id,
      name: user.name,
      password: ''
    });
  }

  function updateUser(change: Partial<UpdateUsuario>) {
    setEditor((current) => {
      if (!current || current.mode === 'password') return current;
      return { ...current, user: { ...current.user, ...change } } as Editor;
    });
  }

  function updatePassword(password: string) {
    setEditor((current) => {
      if (!current) return current;
      if (current.mode === 'create') {
        return { ...current, user: { ...current.user, password } };
      }
      if (current.mode === 'password') {
        return { ...current, password };
      }
      return current;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSubmitting(true);
    setError(null);

    try {
      if (editor.mode === 'password') {
        const response = await fetch(
          `${apiUrl}/admin/usuarios/${editor.id}/senha`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({ password: editor.password })
          }
        );
        await requireSuccessfulResponse(response);
        usuarioSchema.parse(await response.json());
        setRevision((current) => current + 1);
        setEditor(null);
        return;
      }

      const creating = editor.mode === 'create';
      const response = await fetch(
        creating ? `${apiUrl}/admin/usuarios` : `${apiUrl}/admin/usuarios/${editor.id}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(editor.user)
        }
      );
      await requireSuccessfulResponse(response);
      usuarioSchema.parse(await response.json());
      if (creating) {
        if (page === 1) setRevision((current) => current + 1);
        else setPage(1);
      } else {
        setRevision((current) => current + 1);
      }
      setEditor(null);
    } catch (saveError) {
      if (isRevokedSession(saveError)) return;
      if (saveError instanceof RequestError && saveError.status === 409) {
        setError(
          saveError.message === 'Email already in use'
            ? 'Este e-mail já está em uso.'
            : 'A operação removeria o último acesso de Admin.'
        );
      } else {
        setError(
          editor.mode === 'password'
            ? 'Não foi possível redefinir a senha.'
            : 'Não foi possível salvar o usuário.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate(user: Usuario) {
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/admin/usuarios/${user.id}/desativar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      });
      await requireSuccessfulResponse(response);
      usuarioSchema.parse(await response.json());
      setRevision((current) => current + 1);
    } catch (deactivateError) {
      if (isRevokedSession(deactivateError)) return;
      setError(
        deactivateError instanceof RequestError && deactivateError.status === 409
          ? 'A operação removeria o último acesso de Admin.'
          : 'Não foi possível desativar o usuário.'
      );
    }
  }

  const editorTitle =
    editor?.mode === 'create'
      ? 'Criar usuário'
      : editor?.mode === 'password'
        ? 'Definir senha'
        : 'Editar usuário';
  const editorEyebrow =
    editor?.mode === 'create'
      ? 'Novo acesso'
      : editor?.mode === 'password'
        ? 'Redefinição de senha'
        : 'Editar acesso';

  if (!perfil) {
    return <Navigate replace to="/login" />;
  }

  return (
    <section className="users-page">
      <header className="users-heading">
        <div>
          <p className="eyebrow">Administração / Acessos</p>
          <h1>Administração de usuários</h1>
          <p className="users-summary">
            Controle quem acessa o HQ e qual papel cada pessoa desempenha.
          </p>
        </div>
        <div className="users-heading-actions">
          <Link className="back-link" to="/">
            Voltar ao início
          </Link>
          <button
            className="primary-action"
            onClick={() => {
              setError(null);
              setEditor({ mode: 'create', user: { ...emptyUser } });
            }}
            type="button"
          >
            Novo usuário
          </button>
        </div>
      </header>

      {error ? <p className="users-error" role="alert">{error}</p> : null}
      {loading ? (
        <p className="users-loading">Carregando usuários...</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Papel</th>
                <th>Status</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong><span>{user.email}</span></td>
                  <td>{roleNames[user.role]}</td>
                  <td><span className={`user-status ${user.active ? '' : 'inactive'}`}>{user.active ? 'Ativo' : 'Inativo'}</span></td>
                  <td className="user-actions">
                    <button onClick={() => edit(user)} type="button">Editar</button>
                    <button onClick={() => setPassword(user)} type="button">
                      Definir senha
                    </button>
                    {user.active && user.id !== perfil.id ? (
                      <button className="danger-action" onClick={() => deactivate(user)} type="button">Desativar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav aria-label="Paginação de usuários" className="users-pagination">
            <span>
              Página {page} de {totalPages} · {total} usuários
            </span>
            <div>
              <button disabled={page === 1 || loading} onClick={() => setPage((current) => current - 1)} type="button">
                Anterior
              </button>
              <button disabled={page === totalPages || loading} onClick={() => setPage((current) => current + 1)} type="button">
                Próxima
              </button>
            </div>
          </nav>
        </div>
      )}

      {editor ? (
        <div className="user-editor-backdrop">
          <form aria-labelledby="user-editor-title" className="user-editor" onSubmit={save}>
            <header>
              <p className="eyebrow">{editorEyebrow}</p>
              <h2 id="user-editor-title">{editorTitle}</h2>
              {editor.mode === 'password' ? (
                <p className="users-summary">Nova senha para {editor.name}.</p>
              ) : null}
            </header>
            {editor.mode === 'password' ? (
              <PasswordField
                id="user-set-password"
                label="Nova senha"
                required
                value={editor.password}
                onChange={updatePassword}
              />
            ) : (
              <>
                <label>
                  <span>Nome</span>
                  <input required value={editor.user.name} onChange={(event) => updateUser({ name: event.target.value })} />
                </label>
                <label>
                  <span>E-mail</span>
                  <input required type="email" value={editor.user.email} onChange={(event) => updateUser({ email: event.target.value })} />
                </label>
                {editor.mode === 'create' ? (
                  <PasswordField
                    id="user-create-password"
                    label="Senha inicial"
                    required
                    value={editor.user.password}
                    onChange={updatePassword}
                  />
                ) : null}
                <label>
                  <span>Papel</span>
                  <select disabled={editor.mode === 'edit' && editor.id === perfil.id} value={editor.user.role} onChange={(event) => updateUser({ role: event.target.value as UpdateUsuario['role'] })}>
                    <option value="admin">Admin</option>
                    <option value="gestao">Gestão</option>
                    <option value="curador">Curador</option>
                  </select>
                </label>
              </>
            )}
            <footer>
              <button className="editor-cancel" onClick={() => setEditor(null)} type="button">Cancelar</button>
              <button disabled={submitting} type="submit">
                {editor.mode === 'create'
                  ? 'Criar usuário'
                  : editor.mode === 'password'
                    ? 'Salvar senha'
                    : 'Salvar alterações'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
