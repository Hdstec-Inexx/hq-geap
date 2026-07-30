import {
  usuarioSchema,
  type CreateUsuario,
  type UpdateUsuario,
  type Usuario
} from '@hq-geap/contracts/usuarios';
import { z } from 'zod';
import { useEffect, useState, type FormEvent } from 'react';
import { apiUrl, getSession } from '../../auth/session';

const roleNames = {
  admin: 'Admin',
  gestao: 'Gestão',
  curador: 'Curador'
} as const;

type Editor =
  | { mode: 'create'; user: CreateUsuario }
  | { mode: 'edit'; id: string; user: UpdateUsuario };

const emptyUser: CreateUsuario = {
  name: '',
  email: '',
  password: '',
  role: 'curador'
};

export function UsuariosPage() {
  const [users, setUsers] = useState<Usuario[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = getSession()!;
  const token = session.token;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/admin/usuarios`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Users request failed');
        return z.array(usuarioSchema).parse(await response.json());
      })
      .then((result) => {
        setUsers(result);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setError('Não foi possível carregar os usuários.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [token]);

  function edit(user: Usuario) {
    setError(null);
    setEditor({
      mode: 'edit',
      id: user.id,
      user: { name: user.name, email: user.email, role: user.role }
    });
  }

  function updateUser(change: Partial<UpdateUsuario>) {
    setEditor((current) => {
      if (!current) return current;
      return { ...current, user: { ...current.user, ...change } } as Editor;
    });
  }

  function updatePassword(password: string) {
    setEditor((current) =>
      current?.mode === 'create'
        ? { ...current, user: { ...current.user, password } }
        : current
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSubmitting(true);
    setError(null);

    try {
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
      if (!response.ok) {
        if (response.status === 409) throw new Error('duplicate');
        throw new Error('save');
      }
      const saved = usuarioSchema.parse(await response.json());
      setUsers((current) =>
        creating
          ? [saved, ...current]
          : current.map((user) => (user.id === saved.id ? saved : user))
      );
      setEditor(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message === 'duplicate'
          ? 'Este e-mail já está em uso.'
          : 'Não foi possível salvar o usuário.'
      );
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
      if (!response.ok) throw new Error('deactivate');
      const deactivated = usuarioSchema.parse(await response.json());
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === deactivated.id ? deactivated : candidate
        )
      );
    } catch {
      setError('Não foi possível desativar o usuário.');
    }
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
                    {user.active && user.id !== session.user.id ? (
                      <button className="danger-action" onClick={() => deactivate(user)} type="button">Desativar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor ? (
        <div className="user-editor-backdrop">
          <form aria-labelledby="user-editor-title" className="user-editor" onSubmit={save}>
            <header>
              <p className="eyebrow">{editor.mode === 'create' ? 'Novo acesso' : 'Editar acesso'}</p>
              <h2 id="user-editor-title">{editor.mode === 'create' ? 'Criar usuário' : 'Editar usuário'}</h2>
            </header>
            <label>
              <span>Nome</span>
              <input required value={editor.user.name} onChange={(event) => updateUser({ name: event.target.value })} />
            </label>
            <label>
              <span>E-mail</span>
              <input required type="email" value={editor.user.email} onChange={(event) => updateUser({ email: event.target.value })} />
            </label>
            {editor.mode === 'create' ? (
              <label>
                <span>Senha inicial</span>
                <input minLength={8} required type="password" value={editor.user.password} onChange={(event) => updatePassword(event.target.value)} />
              </label>
            ) : null}
            <label>
              <span>Papel</span>
              <select disabled={editor.mode === 'edit' && editor.id === session.user.id} value={editor.user.role} onChange={(event) => updateUser({ role: event.target.value as UpdateUsuario['role'] })}>
                <option value="admin">Admin</option>
                <option value="gestao">Gestão</option>
                <option value="curador">Curador</option>
              </select>
            </label>
            <footer>
              <button className="editor-cancel" onClick={() => setEditor(null)} type="button">Cancelar</button>
              <button disabled={submitting} type="submit">
                {editor.mode === 'create' ? 'Criar usuário' : 'Salvar alterações'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
