import type { FastifyPluginAsync } from 'fastify';
import websocket from '@fastify/websocket';
import { createAtendimentosRepository } from '../atendimentos/repository.js';
import { createAuthRepository } from '../auth/repository.js';
import { createMonitoramentoProxy } from './proxy.js';
import {
  MissingElevenLabsApiKeyError,
  buildElevenLabsMonitorUrl,
  requireElevenLabsApiKey
} from './service.js';

function sendError(socket: { send: (data: string) => void; close: () => void }, message: string) {
  socket.send(JSON.stringify({ type: 'error', message }));
  socket.close();
}

const routes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);
  const atendimentos = createAtendimentosRepository(app.db);
  const auth = createAuthRepository(app.db);

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/atendimentos/:id/monitoramento',
    { websocket: true, config: { auth: false } },
    async (socket, request) => {
      const token = request.query.token;
      if (!token) {
        sendError(socket, 'Autenticação necessária para o Monitoramento ao Vivo');
        return;
      }

      let payload: { sub: string };
      try {
        payload = await app.jwt.verify<{ sub: string }>(token);
      } catch {
        sendError(socket, 'Sessão inválida para o Monitoramento ao Vivo');
        return;
      }

      const user = await auth.findActiveById(payload.sub);
      if (!user) {
        sendError(socket, 'Sessão inválida para o Monitoramento ao Vivo');
        return;
      }

      let apiKey: string;
      try {
        apiKey = requireElevenLabsApiKey(app.config);
      } catch (error) {
        if (error instanceof MissingElevenLabsApiKeyError) {
          sendError(
            socket,
            'ELEVENLABS_API_KEY não configurada. Configure a chave no .env do HQ para o Monitoramento ao Vivo.'
          );
          return;
        }
        throw error;
      }

      const atendimento = await atendimentos.findById(request.params.id);
      if (!atendimento) {
        sendError(socket, 'Atendimento não encontrado');
        return;
      }
      if (atendimento.status !== 'em_andamento') {
        sendError(
          socket,
          'Monitoramento ao Vivo só está disponível para Atendimentos em andamento'
        );
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
