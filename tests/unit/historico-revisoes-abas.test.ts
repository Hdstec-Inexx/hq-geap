import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const curadorPanelPath = new URL(
  '../../apps/web/src/features/avaliacoes/AvaliacaoCuradorPanel.tsx',
  import.meta.url
);
const reviewPagePath = new URL(
  '../../apps/web/src/features/curadoria/CuradoriaReviewPage.tsx',
  import.meta.url
);
const stylesPath = new URL('../../apps/web/src/styles.css', import.meta.url);

test('AvaliacaoCuradorPanel aceita prop historico e renderiza barra de abas quando historico.length > 1', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /historico\?:/,
    'AvaliacaoCuradorPanelProps deve aceitar prop historico opcional'
  );
  assert.match(
    code,
    /review-tabs/,
    'AvaliacaoCuradorPanel deve renderizar o container .review-tabs'
  );
  assert.match(
    code,
    /review-tab-item/,
    'AvaliacaoCuradorPanel deve renderizar os itens com a classe .review-tab-item'
  );
  assert.match(
    code,
    /activeSnapshotIndex|selectedSnapshotIndex|selectedRevisionIndex/,
    'AvaliacaoCuradorPanel deve gerenciar o indice do snapshot ativo'
  );
});

test('AvaliacaoCuradorPanel renderiza badges Vigente para a revisao mais recente e Historico para as anteriores', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /Vigente/,
    'AvaliacaoCuradorPanel deve renderizar o badge Vigente na primeira aba'
  );
  assert.match(
    code,
    /Histórico/,
    'AvaliacaoCuradorPanel deve renderizar o badge Histórico nas abas anteriores'
  );
  assert.match(
    code,
    /review-tab-badge/,
    'AvaliacaoCuradorPanel deve aplicar a classe .review-tab-badge'
  );
});

test('AvaliacaoCuradorPanel nao renderiza barra de abas redundante quando historico.length <= 1', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /historico(?:\.length|\?.length)\s*>\s*1|list\.length\s*>\s*1|revisoes\.length\s*>\s*1/,
    'AvaliacaoCuradorPanel deve condicionar a exibicao da barra de abas a historico.length > 1'
  );
});

test('CuradoriaReviewPage repassa historico para AvaliacaoCuradorPanel e remove bloco legado curadorias-anteriores', async () => {
  const code = await readFile(reviewPagePath, 'utf8');

  assert.match(
    code,
    /historico=\{detail\.historico\}/,
    'CuradoriaReviewPage deve repassar detail.historico para AvaliacaoCuradorPanel'
  );
  assert.doesNotMatch(
    code,
    /className="curadorias-anteriores"/,
    'CuradoriaReviewPage nao deve mais renderizar o bloco legado curadorias-anteriores'
  );
});

test('styles.css define estilos para .review-tabs, .review-tab-item, .review-tab-item.active e badges Vigente/Historico', async () => {
  const css = await readFile(stylesPath, 'utf8');

  assert.match(
    css,
    /\.review-tabs\s*\{/,
    'styles.css deve definir regra para .review-tabs'
  );
  assert.match(
    css,
    /\.review-tab-item\s*\{/,
    'styles.css deve definir regra para .review-tab-item'
  );
  assert.match(
    css,
    /\.review-tab-item\.active\s*\{/,
    'styles.css deve definir regra para .review-tab-item.active'
  );
  assert.match(
    css,
    /\.review-tab-badge\s*\{/,
    'styles.css deve definir regra para .review-tab-badge'
  );
  assert.match(
    css,
    /\.review-tab-badge\.vigente\s*\{/,
    'styles.css deve definir regra para .review-tab-badge.vigente'
  );
  assert.match(
    css,
    /\.review-tab-badge\.historico\s*\{/,
    'styles.css deve definir regra para .review-tab-badge.historico'
  );
});
