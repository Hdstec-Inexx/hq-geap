import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atendimentoDetailCuradorSchema,
  atendimentoDetailGestaoAdminSchema,
  atendimentoDetailSchema,
  favoritoPerfilSchema,
  favoritosInfoSchema,
  mutacaoFavoritoResponseSchema
} from '../../packages/contracts/src/atendimentos.js';

const baseAtendimentoDetail = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  conversationId: 'conv-test-123',
  agenteVoz: {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    nome: 'Lívia',
    agentId: 'agent-1'
  },
  status: 'concluido' as const,
  iniciadoEm: '2026-10-07T12:00:00.000Z',
  concluidoEm: '2026-10-07T12:05:00.000Z',
  duracaoSegundos: 300,
  motivoContato: 'Segunda via de boleto',
  houveTransferencia: false,
  custo: 0.12,
  notaIa: 8.5,
  curadoria: {
    realizada: false,
    curadorId: null,
    curadorNome: null,
    nota: null,
    realizadaEm: null
  },
  transcricao: [
    { role: 'agent' as const, message: 'Olá, sou a Lívia.', time_in_call_secs: 0 }
  ],
  audioUrl: 'https://storage.geap.com.br/audio.mp3'
};

test('favoritoPerfilSchema valida perfil com id uuid e nome', () => {
  const valid = { id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', nome: 'Carlos Curador' };
  assert.deepEqual(favoritoPerfilSchema.parse(valid), valid);
  assert.throws(() => favoritoPerfilSchema.parse({ id: 'invalido', nome: 'Carlos' }));
});

test('favoritosInfoSchema valida contagem e perfis', () => {
  const valid = {
    count: 1,
    perfis: [{ id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', nome: 'Carlos Curador' }]
  };
  assert.deepEqual(favoritosInfoSchema.parse(valid), valid);
  assert.throws(() => favoritosInfoSchema.parse({ count: -1, perfis: [] }));
});

test('mutacaoFavoritoResponseSchema valida favoritadoPeloUsuario boolean', () => {
  assert.deepEqual(mutacaoFavoritoResponseSchema.parse({ favoritadoPeloUsuario: true }), {
    favoritadoPeloUsuario: true
  });
  assert.deepEqual(mutacaoFavoritoResponseSchema.parse({ favoritadoPeloUsuario: false }), {
    favoritadoPeloUsuario: false
  });
});

test('atendimentoDetailCuradorSchema exige favoritadoPeloUsuario booleano', () => {
  const curadorData = {
    ...baseAtendimentoDetail,
    favoritadoPeloUsuario: true
  };
  const parsed = atendimentoDetailCuradorSchema.parse(curadorData);
  assert.equal(parsed.favoritadoPeloUsuario, true);

  // Sem favoritadoPeloUsuario deve falhar
  assert.throws(() => atendimentoDetailCuradorSchema.parse(baseAtendimentoDetail));
});

test('atendimentoDetailGestaoAdminSchema exige favoritos com count e perfis', () => {
  const gestaoData = {
    ...baseAtendimentoDetail,
    favoritos: {
      count: 2,
      perfis: [
        { id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', nome: 'Carlos Curador' },
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', nome: 'Maria Curadora' }
      ]
    }
  };
  const parsed = atendimentoDetailGestaoAdminSchema.parse(gestaoData);
  assert.equal(parsed.favoritos.count, 2);
  assert.equal(parsed.favoritos.perfis.length, 2);

  // Sem favoritos deve falhar
  assert.throws(() => atendimentoDetailGestaoAdminSchema.parse(baseAtendimentoDetail));
});

test('atendimentoDetailSchema tolera campos de favoritos opcionais', () => {
  assert.ok(atendimentoDetailSchema.parse(baseAtendimentoDetail));
  assert.ok(
    atendimentoDetailSchema.parse({
      ...baseAtendimentoDetail,
      favoritadoPeloUsuario: false
    })
  );
  assert.ok(
    atendimentoDetailSchema.parse({
      ...baseAtendimentoDetail,
      favoritos: { count: 0, perfis: [] }
    })
  );
});
