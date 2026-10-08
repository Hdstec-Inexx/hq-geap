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

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function FavoritosPage() {
  const perfil = usePerfil();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const [conversationId, setConversationId] = useState(searchParams.get('conversationId') ?? '');
  const [agenteVozId, setAgenteVozId] = useState(searchParams.get('agenteVozId') ?? '');
  const [perfilId, setPerfilId] = useState(searchParams.get('perfilId') ?? '');
  const agentes = useAuthenticatedResource('/agentes-voz', agentesVozListSchema);
  const curadores = useAuthenticatedResource('/curadores', curadoresListSchema);
  const query = new URLSearchParams({ limit: '50', offset: String((page - 1) * 50) });
  if (searchParams.get('conversationId')) query.set('conversationId', searchParams.get('conversationId')!);
  if (searchParams.get('agenteVozId')) query.set('agenteVozId', searchParams.get('agenteVozId')!);
  if (searchParams.get('perfilId')) query.set('perfilId', searchParams.get('perfilId')!);
  const schema = (perfil?.role === 'curador' ? favoritosCuradorSchema : favoritosGestaoSchema) as z.ZodType<FavoritosCurador | FavoritosGestao>;
  const state = useAuthenticatedResource(`/favoritos?${query}`, schema);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => setRemoved([]), [query.toString()]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (conversationId.trim()) next.set('conversationId', conversationId.trim());
    if (agenteVozId) next.set('agenteVozId', agenteVozId);
    if (perfilId) next.set('perfilId', perfilId);
    next.set('page', '1');
    setSearchParams(next);
  }

  async function remove(item: FavoritoCuradorItem) {
    const session = getSession();
    if (!session) return;
    const response = await fetch(`${apiUrl}/atendimentos/${item.id}/favorito`, {
      method: 'DELETE', headers: { authorization: `Bearer ${session.token}` }
    });
    if (response.ok) setRemoved((current) => [...current, item.id]);
  }

  const items = state.status === 'ready' ? state.data.items.filter((item) => !removed.includes(item.id)) : [];
  return (
    <main className="atendimentos-page">
      <header className="atendimentos-heading"><div><p className="eyebrow">Operação / atemporal</p><h1>Favoritos</h1></div><Link className="back-link" to="/">Voltar ao início</Link></header>
      <form className="atendimentos-filters" onSubmit={submit}>
        <label>ID da conversa<input value={conversationId} onChange={(event) => setConversationId(event.target.value)} placeholder="Buscar por ID..." /></label>
        <label>Agente de Voz<select value={agenteVozId} onChange={(event) => setAgenteVozId(event.target.value)}><option value="">Todos os agentes</option>{agentes.status === 'ready' && agentes.data.map((agente) => <option key={agente.id} value={agente.id}>{agente.nome}</option>)}</select></label>
        {perfil?.role !== 'curador' ? <label>Perfil de Curador<select value={perfilId} onChange={(event) => setPerfilId(event.target.value)}><option value="">Todos os perfis</option>{curadores.status === 'ready' && curadores.data.map((curador) => <option key={curador.id} value={curador.id}>{curador.nome}</option>)}</select></label> : null}
        <button className="primary-action" type="submit">Filtrar</button>
      </form>
      {state.status === 'error' ? <p className="atendimentos-state atendimentos-state-error">Não foi possível carregar os Favoritos.</p> : null}
      {items.length === 0 && state.status === 'ready' ? <p className="atendimentos-state">Nenhum Favorito encontrado.</p> : null}
      <section aria-label="Lista de Favoritos" className="atendimentos-list">
        {items.map((item) => {
          const gestaoItem = item as FavoritoGestaoItem;
          return <article className="atendimento-row" key={item.id}>
            <div><strong>{item.agenteVoz.nome}</strong><Link to={`/atendimentos/${item.id}`}>{item.conversationId}</Link><small>{dateTime(perfil?.role === 'curador' ? (item as FavoritoCuradorItem).favoritadoEm : gestaoItem.ultimoFavoritadoEm)}</small></div>
            {perfil?.role === 'curador' ? <button aria-label={`Desfazer favorito de ${item.conversationId}`} onClick={() => remove(item as unknown as FavoritoCuradorItem)} type="button">★</button> : <span>{formatPerfisFavoritos(gestaoItem.favoritos.perfis)}</span>}
          </article>;
        })}
      </section>
      {state.status === 'ready' && state.data.total > 50 ? <nav aria-label="Paginação de Favoritos" className="pagination-controls">
        {page > 1 ? <button type="button" onClick={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.set('page', String(page - 1)); return next; })}>Anterior</button> : null}
        <span>Página {page} de {Math.ceil(state.data.total / 50)}</span>
        {page * 50 < state.data.total ? <button type="button" onClick={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.set('page', String(page + 1)); return next; })}>Próxima</button> : null}
      </nav> : null}
    </main>
  );
}
