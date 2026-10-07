import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUseMethod
} from '../../apps/api/src/modules/auth/policy.js';
import {
  createAtendimentosRepository,
  type AtendimentoRow
} from '../../apps/api/src/modules/atendimentos/repository.js';
import { isCuradorRole } from '../../apps/api/src/modules/atendimentos/routes.js';
import { toAtendimentoDetail } from '../../apps/api/src/modules/atendimentos/service.js';

test('autorizacao de favoritos: apenas Curador pode mutar, Gestao e Admin recebem 403', async () => {
  // 1. Gestao tem acesso somente leitura (bloqueado nos metodos de mutacao)
  assert.equal(canUseMethod('gestao', 'POST'), false, 'Gestao nao pode fazer POST');
  assert.equal(canUseMethod('gestao', 'DELETE'), false, 'Gestao nao pode fazer DELETE');
  assert.equal(canUseMethod('curador', 'POST'), true, 'Curador pode fazer POST');
  assert.equal(canUseMethod('curador', 'DELETE'), true, 'Curador pode fazer DELETE');

  // 2. Verificacao real de papel usada pelo preHandler da rota
  assert.equal(isCuradorRole({ role: 'curador' }), true);
  assert.equal(isCuradorRole({ role: 'gestao' }), false);
  assert.equal(isCuradorRole({ role: 'admin' }), false);
  assert.equal(isCuradorRole(null), false);
});

test('repository de favoritos garante unicidade (on conflict) e delecao individual', async () => {
  const executedQueries: Array<{ text: string; values: unknown[] }> = [];

  const mockDb = {
    async query(text: string, values: unknown[] = []) {
      executedQueries.push({ text: text.trim(), values });
      if (text.includes('exists(')) {
        return { rows: [{ exists: true }] };
      }
      if (text.includes('select u.id, u.nome')) {
        return {
          rows: [
            { id: '11111111-1111-4111-8111-111111111111', nome: 'Curador Um' },
            { id: '22222222-2222-4222-8222-222222222222', nome: 'Curador Dois' }
          ]
        };
      }
      return { rows: [] };
    },
    async connect() {
      throw new Error('Not implemented in mock');
    }
  } as any;

  const repo = createAtendimentosRepository(mockDb);

  const atendimentoId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const perfilId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  // 1. Adicionar favorito duas vezes (idempotencia e unicidade)
  await repo.addFavorito(atendimentoId, perfilId);
  await repo.addFavorito(atendimentoId, perfilId);
  const insertQuery = executedQueries[0]!;
  assert.match(insertQuery.text, /insert into favoritos/i);
  assert.match(insertQuery.text, /on conflict \(perfil_id, atendimento_id\) do nothing/i);
  assert.deepEqual(insertQuery.values, [perfilId, atendimentoId]);

  // 2. Remover favorito (desfaz exclusivamente o favorito do usuario autenticado)
  await repo.removeFavorito(atendimentoId, perfilId);
  const deleteQuery = executedQueries[2]!;
  assert.match(deleteQuery.text, /delete from favoritos/i);
  assert.match(deleteQuery.text, /where atendimento_id = \$1 and perfil_id = \$2/i);
  assert.deepEqual(deleteQuery.values, [atendimentoId, perfilId]);

  // 3. Verificar se perfil favoritou
  const isFav = await repo.isFavoritadoByPerfil(atendimentoId, perfilId);
  assert.equal(isFav, true);
  const existsQuery = executedQueries[3]!;
  assert.match(existsQuery.text, /select exists\(/i);
  assert.deepEqual(existsQuery.values, [atendimentoId, perfilId]);

  // 4. Buscar lista de favoritos para gestao/admin
  const favs = await repo.findFavoritos(atendimentoId);
  assert.equal(favs.count, 2);
  assert.equal(favs.perfis.length, 2);
  const findQuery = executedQueries[4]!;
  assert.match(findQuery.text, /from favoritos f\s+join usuarios u/i);
  assert.deepEqual(findQuery.values, [atendimentoId]);
});

test('toAtendimentoDetail mapeia favoritadoPeloUsuario para Curador e favoritos para Gestao/Admin', () => {
  const row: AtendimentoRow = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    conversationId: 'conv-test-999',
    agenteVozId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    agenteVozNome: 'Lívia',
    agentId: 'agent-livia',
    status: 'concluido',
    iniciadoEm: new Date('2026-10-07T12:00:00.000Z'),
    concluidoEm: new Date('2026-10-07T12:05:00.000Z'),
    duracaoSegundos: 300,
    motivoContato: 'Informações',
    houveTransferencia: false,
    custo: '0.15',
    notaIa: '9.0',
    eventTimestamp: '123456789',
    curadorId: null,
    curadorNome: null,
    curadoriaNota: null,
    curadoriaRealizadaEm: null,
    transcricao: [{ role: 'agent', message: 'Bom dia', time_in_call_secs: 0 }],
    audioReference: 'audio/test.mp3'
  };

  // Curador: retorna favoritadoPeloUsuario
  const curadorDetail = toAtendimentoDetail(row, 'https://example.com/audio.mp3', {
    favoritadoPeloUsuario: true
  });
  assert.equal(curadorDetail.favoritadoPeloUsuario, true);
  assert.equal(curadorDetail.favoritos, undefined);

  // Gestao/Admin: retorna favoritos { count, perfis }
  const gestaoDetail = toAtendimentoDetail(row, 'https://example.com/audio.mp3', {
    favoritos: {
      count: 1,
      perfis: [{ id: '11111111-1111-4111-8111-111111111111', nome: 'Carlos Curador' }]
    }
  });
  assert.equal(gestaoDetail.favoritadoPeloUsuario, undefined);
  assert.deepEqual(gestaoDetail.favoritos, {
    count: 1,
    perfis: [{ id: '11111111-1111-4111-8111-111111111111', nome: 'Carlos Curador' }]
  });
});
