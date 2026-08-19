import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelPath = new URL('../../apps/web/src/features/avaliacoes/AvaliacaoIaPanel.tsx', import.meta.url);
const stylesPath = new URL('../../apps/web/src/styles.css', import.meta.url);

test('AvaliacaoIaPanel nao renderiza versao do prompt nem claims da LLM', async () => {
  const panelContent = await readFile(panelPath, 'utf8');

  // Não deve exibir Prompt v... no cabeçalho
  assert.equal(
    /Prompt\s+v/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve conter menção a Prompt v'
  );
  assert.equal(
    /promptVersao/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve usar promptVersao'
  );

  // Não deve conter seção ou textos de Claims da LLM
  assert.equal(
    /Claims\s+da\s+LLM/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve conter seção Claims da LLM'
  );
  assert.equal(
    /Nota\s+claim/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve conter Nota claim'
  );
  assert.equal(
    /Aprovação\s+claim/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve conter Aprovação claim'
  );
  assert.equal(
    /notaQualidade/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve referenciar notaQualidade'
  );
  assert.equal(
    /atendimentoAprovado/i.test(panelContent),
    false,
    'AvaliacaoIaPanel não deve referenciar atendimentoAprovado'
  );
});

test('AvaliacaoIaPanel e styles.css aplicam scrollbar personalizada com max-height 180px no Resumo', async () => {
  const panelContent = await readFile(panelPath, 'utf8');
  const stylesContent = await readFile(stylesPath, 'utf8');

  // Painel deve conter a classe de scroll no resumo
  assert.match(
    panelContent,
    /avaliacao-resumo-scroll/,
    'AvaliacaoIaPanel deve aplicar a classe avaliacao-resumo-scroll no resumo'
  );

  // styles.css deve definir max-height: 180px e overflow-y: auto para o resumo
  assert.match(
    stylesContent,
    /\.avaliacao-resumo-scroll\s*\{[^}]*max-height:\s*180px;/s,
    'styles.css deve ter max-height: 180px em .avaliacao-resumo-scroll'
  );
  assert.match(
    stylesContent,
    /\.avaliacao-resumo-scroll\s*\{[^}]*overflow-y:\s*auto;/s,
    'styles.css deve ter overflow-y: auto em .avaliacao-resumo-scroll'
  );

  // styles.css deve ter personalização de scrollbar (standard e webkit)
  assert.match(
    stylesContent,
    /\.avaliacao-resumo-scroll\s*\{[^}]*scrollbar-width:\s*thin;/s,
    'styles.css deve definir scrollbar-width: thin'
  );
  assert.match(
    stylesContent,
    /\.avaliacao-resumo-scroll::-webkit-scrollbar/s,
    'styles.css deve definir ::-webkit-scrollbar para .avaliacao-resumo-scroll'
  );
});
