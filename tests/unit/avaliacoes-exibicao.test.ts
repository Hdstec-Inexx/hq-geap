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
    /\.avaliacoes-lado-a-lado\s*\.avaliacao-panel\s*\{[^}]*transition:\s*all/i,
    'painel de avaliação deve ter transição suave para expansão'
  );
  assert.match(
    css,
    /@media\s*\([^)]*max-width:\s*960px\)[^{]*\{[\s\S]*?\.avaliacoes-lado-a-lado\s*\{[^}]*grid-template-columns:\s*1fr/i,
    'avaliacoes-lado-a-lado deve ter comportamento responsivo de coluna única em telas <= 960px'
  );
});
