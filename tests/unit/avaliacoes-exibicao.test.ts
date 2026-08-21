import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contextPath = new URL('../../CONTEXT.md', import.meta.url);
const stylesPath = new URL('../../apps/web/src/styles.css', import.meta.url);
const curadorPanelPath = new URL(
  '../../apps/web/src/features/avaliacoes/AvaliacaoCuradorPanel.tsx',
  import.meta.url
);

test('CONTEXT.md define regras de acesso ao download de audio para Admin e Gestao e restricao para Curador', async () => {
  const context = await readFile(contextPath, 'utf8');

  assert.match(
    context,
    /Download de [Áá]udio/i,
    'CONTEXT.md deve documentar o conceito de Download de Áudio'
  );
  assert.match(
    context,
    /Download de [Áá]udio[\s\S]*?Admin[\s\S]*?Gest[ãa]o/i,
    'Download de áudio deve especificar acesso para Admin e Gestão'
  );
  assert.match(
    context,
    /Download de [Áá]udio[\s\S]*?Curador[\s\S]*?sem permissão para download/i,
    'Download de áudio deve explicitar a restrição para o Curador'
  );
});

test('CONTEXT.md define semantica da exibicao da avaliacao do curador e expansao da avaliacao da IA', async () => {
  const context = await readFile(contextPath, 'utf8');

  assert.match(
    context,
    /placeholder|card vazio/i,
    'CONTEXT.md deve explicitar a ausência de card vazio ou placeholder quando a curadoria não for realizada'
  );
  assert.match(
    context,
    /largura total/i,
    'CONTEXT.md deve explicitar que o painel da IA expande para ocupar a largura total'
  );
  assert.match(
    context,
    /lado a lado/i,
    'CONTEXT.md deve explicitar que ambos os painéis coexistem lado a lado quando a curadoria existir'
  );
});

test('AvaliacaoCuradorPanel nao renderiza mensagem de placeholder nem cards vazios quando avaliacao for nula ou pendente', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.doesNotMatch(
    code,
    /Avaliação do Curador ainda não disponível/i,
    'AvaliacaoCuradorPanel não deve conter mensagem de placeholder'
  );
  assert.match(
    code,
    /state\.status !== 'ready'\s*\|\|\s*state\.data === null/,
    'AvaliacaoCuradorPanel deve retornar null quando os dados da avaliação não estiverem prontos ou forem nulos'
  );
});

test('AvaliacaoCuradorPanel delimita bloco superior com scroll e renderiza comentario abaixo da grade de criterios', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  // Bloco superior deve ter container de scroll para resumo e falhas
  assert.match(
    code,
    /avaliacao-curador-top-scroll/,
    'AvaliacaoCuradorPanel deve aplicar a classe avaliacao-curador-top-scroll no bloco superior'
  );

  // Comentário da revisão deve ter container dedicado com scroll
  assert.match(
    code,
    /avaliacao-curador-comentario/,
    'AvaliacaoCuradorPanel deve aplicar a classe avaliacao-curador-comentario no container do comentário'
  );
  assert.match(
    code,
    /avaliacao-comentario-scroll/,
    'AvaliacaoCuradorPanel deve aplicar a classe avaliacao-comentario-scroll no parágrafo do comentário'
  );
  assert.match(
    code,
    /Comentário da revisão/,
    'AvaliacaoCuradorPanel deve exibir label Comentário da revisão'
  );

  // Ordem do DOM: o bloco superior vem antes da checklist e o comentário vem depois da checklist
  const topIndex = code.indexOf('avaliacao-curador-top-scroll');
  const checklistIndex = code.indexOf('avaliacao-checklist');
  const comentarioIndex = code.indexOf('avaliacao-curador-comentario');

  assert.ok(topIndex !== -1, 'avaliacao-curador-top-scroll deve existir');
  assert.ok(checklistIndex !== -1, 'avaliacao-checklist deve existir');
  assert.ok(comentarioIndex !== -1, 'avaliacao-curador-comentario deve existir');
  assert.ok(
    topIndex < checklistIndex,
    'Bloco superior de resumo/falhas deve vir antes da grade de critérios'
  );
  assert.ok(
    checklistIndex < comentarioIndex,
    'Comentário da revisão deve ser renderizado abaixo da grade de critérios'
  );
});

test('styles.css define limites de altura e barras de rolagem para bloco superior e comentario do Curador', async () => {
  const css = await readFile(stylesPath, 'utf8');

  assert.match(
    css,
    /\.avaliacao-curador-top-scroll[^}]*max-height:\s*200px;/s,
    'styles.css deve ter max-height: 200px para .avaliacao-curador-top-scroll'
  );
  assert.match(
    css,
    /\.avaliacao-curador-top-scroll[^}]*overflow-y:\s*auto;/s,
    'styles.css deve ter overflow-y: auto para .avaliacao-curador-top-scroll'
  );
  assert.match(
    css,
    /\.avaliacao-comentario-scroll[^}]*max-height:\s*200px;/s,
    'styles.css deve ter max-height: 200px para .avaliacao-comentario-scroll'
  );
  assert.match(
    css,
    /\.avaliacao-comentario-scroll[^}]*overflow-y:\s*auto;/s,
    'styles.css deve ter overflow-y: auto para .avaliacao-comentario-scroll'
  );
  assert.match(
    css,
    /\.avaliacao-curador-top-scroll::-webkit-scrollbar/s,
    'styles.css deve definir ::-webkit-scrollbar para .avaliacao-curador-top-scroll'
  );
  assert.match(
    css,
    /\.avaliacao-comentario-scroll::-webkit-scrollbar/s,
    'styles.css deve definir ::-webkit-scrollbar para .avaliacao-comentario-scroll'
  );
});

test('styles.css expande a Avaliacao da IA para 100% da largura quando for o unico painel no container', async () => {
  const css = await readFile(stylesPath, 'utf8');

  assert.match(
    css,
    /\.avaliacoes-lado-a-lado\s*\{[^}]*display:\s*grid/i,
    'avaliacoes-lado-a-lado deve usar CSS grid'
  );
  assert.match(
    css,
    /\.avaliacoes-lado-a-lado\s*>\s*\.avaliacao-panel:only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/i,
    'painel único dentro de avaliacoes-lado-a-lado deve ter grid-column: 1 / -1 para ocupar 100% da largura'
  );
  assert.match(
    css,
    /\.avaliacoes-lado-a-lado\s*\.avaliacao-panel\s*\{[^}]*transition:\s*opacity/i,
    'painel de avaliação deve ter transição suave para expansão'
  );
  assert.match(
    css,
    /@media\s*\([^)]*max-width:\s*960px\)[^{]*\{[\s\S]*?\.avaliacoes-lado-a-lado\s*\{[^}]*grid-template-columns:\s*1fr/i,
    'avaliacoes-lado-a-lado deve ter comportamento responsivo de coluna única em telas <= 960px'
  );
});
