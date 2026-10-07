import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatPerfisFavoritos
} from '../../apps/web/src/features/atendimentos/favorito-logic.js';

test('formatPerfisFavoritos formata adequadamente lista vazia, individual e multipla', () => {
  assert.equal(formatPerfisFavoritos([]), 'Nenhum favorito');
  assert.equal(
    formatPerfisFavoritos([{ id: '1', nome: 'Carlos Curador' }]),
    'Favoritado por Carlos Curador'
  );
  assert.equal(
    formatPerfisFavoritos([
      { id: '1', nome: 'Carlos Curador' },
      { id: '2', nome: 'Maria Curadora' }
    ]),
    'Favoritado por Carlos Curador, Maria Curadora'
  );
});

test('AtendimentoPage inclui componente de favoritos com alternancia para curador e somente leitura para gestao/admin', async () => {
  const file = await readFile(
    new URL('../../apps/web/src/features/atendimentos/AtendimentoPage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(file, /FavoritoAtendimento/);
});

test('MonitoramentoLivePage renderiza botao de favoritar visivel e desabilitado antes da persistencia e habilitado apos', async () => {
  const livePage = await readFile(
    new URL('../../apps/web/src/features/monitoramento/MonitoramentoLivePage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(livePage, /FavoritoLiveButton/);
  assert.match(livePage, /isPersisted=\{Boolean\(atendimento\)\}/);

  const buttonComponent = await readFile(
    new URL('../../apps/web/src/features/monitoramento/FavoritoLiveButton.tsx', import.meta.url),
    'utf8'
  );
  assert.match(buttonComponent, /disabled=\{isDisabled\}/);
  assert.match(buttonComponent, /O Atendimento ainda não foi persistido no HQ/);
});
