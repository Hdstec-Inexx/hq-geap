import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import websocket from '@fastify/websocket';
import {
  conversationIdSchema,
  type MonitoramentoConversa
} from '@hq-geap/contracts/monitoramento';
import type { WebSocket as WsWebSocket } from 'ws';
import { createAtendimentosRepository } from '../atendimentos/repository.js';
import { createAuthRepository } from '../auth/repository.js';
import {
  sessionMatchesPasswordVersion,
  type SessionTokenClaims
} from '../auth/service.js';
import { waitForMonitoramentoAuthToken } from './auth.js';
import { createMonitoramentoProxy } from './proxy.js';
import {
  ConversationNotOpenError,
  ElevenLabsListError,
  MissingElevenLabsApiKeyError,
  buildElevenLabsMonitorUrl,
  excludeLocallyConcludedConversations,
  listLiveConversationsFromElevenLabs,
  requireElevenLabsApiKey,
  requireOpenConversationAtElevenLabs
} from './service.js';

function sendError(socket: WsWebSocket, message: string) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: 'error', message }));
  }
  socket.close();
}

async function requireMonitorApiKey(
  app: FastifyInstance,
  socket: WsWebSocket
): Promise<string | null> {
  try {
    return requireElevenLabsApiKey(app.config);
  } catch (error) {
    if (error instanceof MissingElevenLabsApiKeyError) {
      sendError(
        socket,
        'ELEVENLABS_API_KEY não configurada. Configure a chave no .env do HQ para o Monitoramento ao Vivo.'
      );
      return null;
    }
    throw error;
  }
}

async function authenticateMonitorClient(
  app: FastifyInstance,
  socket: WsWebSocket,
  findActiveById: (
    id: string
  ) => Promise<{ id: string; passwordVersion: number } | null>
): Promise<boolean> {
  const token = await waitForMonitoramentoAuthToken(socket);
  if (!token) {
    sendError(socket, 'Autenticação necessária para o Monitoramento ao Vivo');
    return false;
  }
  if (socket.readyState !== socket.OPEN) {
    return false;
  }

  let payload: SessionTokenClaims;
  try {
    payload = await app.jwt.verify<SessionTokenClaims>(token);
  } catch {
    sendError(socket, 'Sessão inválida para o Monitoramento ao Vivo');
    return false;
  }

  const user = await findActiveById(payload.sub);
  if (!user || !sessionMatchesPasswordVersion(payload, user.passwordVersion)) {
    sendError(socket, 'Sessão inválida para o Monitoramento ao Vivo');
    return false;
  }
  return true;
}

async function requireOpenUpstreamConversation(
  app: FastifyInstance,
  socket: WsWebSocket,
  apiKey: string,
  conversationId: string
): Promise<boolean> {
  try {
    await requireOpenConversationAtElevenLabs({
      apiBaseUrl: app.config.ELEVENLABS_API_URL,
      apiKey,
      conversationId
    });
    return true;
  } catch (error) {
    if (error instanceof ConversationNotOpenError) {
      sendError(socket, error.message);
      return false;
    }
    if (error instanceof ElevenLabsListError) {
      sendError(socket, error.message);
      return false;
    }
    throw error;
  }
}

const routes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);
  const atendimentos = createAtendimentosRepository(app.db);
  const auth = createAuthRepository(app.db);

  app.get(
    '/monitoramento/conversas',
    async (): Promise<MonitoramentoConversa[]> => {
      let apiKey: string;
      try {
        apiKey = requireElevenLabsApiKey(app.config);
      } catch (error) {
        if (error instanceof MissingElevenLabsApiKeyError) {
          throw app.httpErrors.serviceUnavailable(
            'ELEVENLABS_API_KEY não configurada. Configure a chave no .env do HQ para o Monitoramento ao Vivo.'
          );
        }
        throw error;
      }

      let live;
      try {
        live = await listLiveConversationsFromElevenLabs({
          apiBaseUrl: app.config.ELEVENLABS_API_URL,
          apiKey
        });
      } catch (error) {
        if (error instanceof ElevenLabsListError) {
          throw app.httpErrors.badGateway(error.message);
        }
        throw error;
      }

      const conversationIds = live.map((item) => item.conversationId);
      const concluded =
        conversationIds.length === 0
          ? { rows: [] as Array<{ conversationId: string }> }
          : await app.db.query<{ conversationId: string }>(
              `
                select elevenlabs_conversation_id as "conversationId"
                from atendimentos
                where status = 'concluido'
                  and elevenlabs_conversation_id = any($1::text[])
              `,
              [conversationIds]
            );
      live = excludeLocallyConcludedConversations(
        live,
        new Set(concluded.rows.map((row) => row.conversationId))
      );

      const agentIds = [...new Set(live.map((item) => item.agentId))];
      const agents =
        agentIds.length === 0
          ? { rows: [] as Array<{ agentId: string; nome: string }> }
          : await app.db.query<{ agentId: string; nome: string }>(
              `
                select elevenlabs_agent_id as "agentId", nome
                from agentes_voz
                where elevenlabs_agent_id = any($1::text[])
              `,
              [agentIds]
            );
      const names = new Map(
        agents.rows.map((row) => [row.agentId, row.nome] as const)
      );

      return live.map((item) => ({
        conversationId: item.conversationId,
        agentId: item.agentId,
        agenteVozNome: names.get(item.agentId) ?? null,
        status: item.status,
        iniciadoEm: item.iniciadoEm
      }));
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    '/monitoramento/conversas/:conversationId',
    { websocket: true, config: { auth: false } },
    async (socket, request) => {
      const parsed = conversationIdSchema.safeParse(
        request.params.conversationId
      );
      if (!parsed.success) {
        sendError(socket, 'Identificador de conversa inválido');
        return;
      }
      if (!(await authenticateMonitorClient(app, socket, auth.findActiveById))) {
        return;
      }
      const apiKey = await requireMonitorApiKey(app, socket);
      if (!apiKey) {
        return;
      }
      if (
        !(await requireOpenUpstreamConversation(
          app,
          socket,
          apiKey,
          parsed.data
        ))
      ) {
        return;
      }
      createMonitoramentoProxy({
        client: socket,
        apiKey,
        monitorUrl: buildElevenLabsMonitorUrl(
          app.config.ELEVENLABS_API_URL,
          parsed.data
        )
      });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/atendimentos/:id/monitoramento',
    { websocket: true, config: { auth: false } },
    async (socket, request) => {
      if (!(await authenticateMonitorClient(app, socket, auth.findActiveById))) {
        return;
      }
      const apiKey = await requireMonitorApiKey(app, socket);
      if (!apiKey) {
        return;
      }

      const atendimento = await atendimentos.findById(request.params.id);
      if (!atendimento) {
        sendError(socket, 'Atendimento não encontrado');
        return;
      }
      if (
        !(await requireOpenUpstreamConversation(
          app,
          socket,
          apiKey,
          atendimento.conversationId
        ))
      ) {
        return;
      }

      createMonitoramentoProxy({
        client: socket,
        apiKey,
        monitorUrl: buildElevenLabsMonitorUrl(
          app.config.ELEVENLABS_API_URL,
          atendimento.conversationId
        )
      });
    }
  );
};

export default routes;
