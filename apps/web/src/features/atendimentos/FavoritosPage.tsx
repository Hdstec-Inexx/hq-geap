import {
  agentesVozListSchema,
  favoritosCuradorSchema,
  favoritosGestaoSchema,
  type FavoritosCurador,
  type FavoritosGestao,
  type FavoritoCuradorItem,
  type FavoritoGestaoItem
} from '@hq-geap/contracts/favoritos';
import { curadoresListSchema } from '@hq-geap/contracts/curadoria';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Link, useSearchParams } from 'react-router-dom';
import { usePerfil } from '../auth/perfil-context';
import { apiUrl, getSession } from '../auth/session';
import { useAuthenticatedResource } from './api';
import { formatPerfisFavoritos } from './favorito-logic';

const FAVORITOS_PAGE_SIZE = 50;
const FAVORITOS_MAX_OFFSET = 10_000;
const FAVORITOS_MAX_PAGE = Math.floor(FAVORITOS_MAX_OFFSET / FAVORITOS_PAGE_SIZE) + 1;

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function FavoritosPage() {
  const perfil = usePerfil();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.min(FAVORITOS_MAX_PAGE, Math.max(1, Number(searchParams.get('page') ?? '1') || 1));
  const [conversationId, setConversationId] = useState(searchParams.get('conversationId') ?? '');
  const [agenteVozId, setAgenteVozId] = useState(searchParams.get('agenteVozId') ?? '');
  const [perfilId, setPerfilId] = useState(searchParams.get('perfilId') ?? '');
  const agentes = useAuthenticatedResource('/agentes-voz', agentesVozListSchema);
  const curadores = useAuthenticatedResource('/curadores', curadoresListSchema);
  const query = new URLSearchParams({ limit: String(FAVORITOS_PAGE_SIZE), offset: String((page - 1) * FAVORITOS_PAGE_SIZE) });
  if (searchParams.get('conversationId')) query.set('conversationId', searchParams.get('conversationId')!);
  if (searchParams.get('agenteVozId')) query.set('agenteVozId', searchParams.get('agenteVozId')!);
  if (searchParams.get('perfilId')) query.set('perfilId', searchParams.get('perfilId')!);
  const schema = (perfil?.role === 'curador' ? favoritosCuradorSchema : favoritosGestaoSchema) as z.ZodType<FavoritosCurador | FavoritosGestao>;
  const state = useAuthenticatedResource(`/favoritos?${query}`, schema);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => setRemoved([]), [query.toString()]);

  const hasActiveFilters = Boolean(
    searchParams.get('conversationId') ||
      searchParams.get('agenteVozId') ||
      searchParams.get('perfilId')
  );

  useEffect(() => {
    setConversationId(searchParams.get('conversationId') ?? '');
    setAgenteVozId(searchParams.get('agenteVozId') ?? '');
    setPerfilId(searchParams.get('perfilId') ?? '');
  }, [searchParams]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (conversationId.trim()) next.set('conversationId', conversationId.trim());
    if (agenteVozId) next.set('agenteVozId', agenteVozId);
    if (perfilId) next.set('perfilId', perfilId);
    next.set('page', '1');
    setSearchParams(next);
  }

  function handleClearFilters() {
    setConversationId('');
    setAgenteVozId('');
    setPerfilId('');
    setSearchParams(new URLSearchParams({ page: '1' }));
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  }

  async function remove(item: FavoritoCuradorItem) {
    const session = getSession();
    if (!session) return;
    const response = await fetch(`${apiUrl}/atendimentos/${item.id}/favorito`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session.token}` }
    });
    if (response.ok) setRemoved((current) => [...current, item.id]);
  }

  const items = state.status === 'ready' ? state.data.items.filter((item) => !removed.includes(item.id)) : [];
  const totalPages = state.status === 'ready' ? Math.max(1, Math.ceil(state.data.total / FAVORITOS_PAGE_SIZE)) : 1;

  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading">
        <div>
          <p className="eyebrow">Operação / atemporal</p>
          <h1>Favoritos</h1>
        </div>
        <Link className="back-link" to="/">
          Voltar ao início
        </Link>
      </header>

      <form className="atendimentos-filters" onSubmit={submit}>
        <div className="atendimentos-filters-fields">
          <label>
            ID externo do Atendimento
            <input
              type="text"
              value={conversationId}
              onChange={(event) => setConversationId(event.target.value)}
              placeholder="Buscar por ID..."
            />
          </label>
          <label>
            Agente de Voz
            <select
              value={agenteVozId}
              onChange={(event) => setAgenteVozId(event.target.value)}
            >
              <option value="">Todos os agentes</option>
              {agentes.status === 'ready' &&
                agentes.data.map((agente) => (
                  <option key={agente.id} value={agente.id}>
                    {agente.nome}
                  </option>
                ))}
            </select>
          </label>
          {perfil?.role !== 'curador' ? (
            <label>
              Perfil de Curador
              <select
                value={perfilId}
                onChange={(event) => setPerfilId(event.target.value)}
              >
                <option value="">Todos os perfis</option>
                {curadores.status === 'ready' &&
                  curadores.data.map((curador) => (
                    <option key={curador.id} value={curador.id}>
                      {curador.nome}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="atendimentos-filters-actions">
          <button className="primary-action" type="submit">
            Filtrar
          </button>
          {hasActiveFilters ? (
            <button
              className="atendimentos-filter-clear"
              type="button"
              onClick={handleClearFilters}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </form>

      {state.status === 'loading' ? (
        <p className="atendimentos-state">Carregando Favoritos...</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="atendimentos-state atendimentos-state-error">
          Não foi possível carregar os Favoritos.
        </p>
      ) : null}
      {items.length === 0 && state.status === 'ready' ? (
        <div className="curadoria-empty">
          <h2>Nenhum Favorito encontrado</h2>
          <p>
            {hasActiveFilters
              ? 'Não há Atendimentos favoritados para os filtros selecionados.'
              : perfil?.role === 'curador'
                ? 'Você ainda não marcou nenhum Atendimento como Favorito.'
                : 'Não há Atendimentos com Favorito ativo registrado.'}
          </p>
        </div>
      ) : null}

      {items.length > 0 && state.status === 'ready' ? (
        <div className="favoritos-table-wrap">
          <table aria-label="Lista de Favoritos" className="favoritos-table">
            <thead>
              <tr>
                <th scope="col">Agente de Voz</th>
                <th scope="col">ID da conversa</th>
                <th scope="col">Favoritado em</th>
                <th scope="col">Perfis</th>
                {perfil?.role === 'curador' ? (
                  <th scope="col" className="favoritos-th-action">
                    Ação
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const gestaoItem = item as FavoritoGestaoItem;
                const timestamp =
                  perfil?.role === 'curador'
                    ? (item as FavoritoCuradorItem).favoritadoEm
                    : gestaoItem.ultimoFavoritadoEm;
                const perfisText =
                  perfil?.role === 'curador'
                    ? 'Você'
                    : formatPerfisFavoritos(gestaoItem.favoritos.perfis);

                return (
                  <tr key={item.id}>
                    <td className="favoritos-cell-agente">
                      <strong>{item.agenteVoz.nome}</strong>
                    </td>
                    <td className="favoritos-cell-conversa">
                      <Link to={`/atendimentos/${item.id}`}>{item.conversationId}</Link>
                    </td>
                    <td className="favoritos-cell-data">
                      <time dateTime={timestamp}>{dateTime(timestamp)}</time>
                    </td>
                    <td className="favoritos-cell-perfis">
                      <span className="favoritos-perfis-badge">{perfisText}</span>
                    </td>
                    {perfil?.role === 'curador' ? (
                      <td className="favoritos-cell-action">
                        <button
                          type="button"
                          className="favorito-star-button active"
                          aria-label={`Desfazer favorito de ${item.conversationId}`}
                          title={`Desfazer favorito de ${item.conversationId}`}
                          onClick={() => remove(item as unknown as FavoritoCuradorItem)}
                        >
                          <span className="favorito-star-icon" aria-hidden="true">
                            ★
                          </span>
                          <span className="favorito-label">Favoritado</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {state.data.total > FAVORITOS_PAGE_SIZE ? (
            <nav aria-label="Paginação de Favoritos" className="users-pagination">
              <span>
                Página {page} de {totalPages} ({state.data.total} atendimentos)
              </span>
              <div>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || page >= FAVORITOS_MAX_PAGE}
                  onClick={() => goToPage(page + 1)}
                >
                  Próxima
                </button>
              </div>
            </nav>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
