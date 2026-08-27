import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const curadorPanelPath = new URL(
  '../../apps/web/src/features/avaliacoes/AvaliacaoCuradorPanel.tsx',
  import.meta.url
);
const tooltipPath = new URL(
  '../../apps/web/src/features/avaliacoes/CriterionTooltip.tsx',
  import.meta.url
);
const reviewPagePath = new URL(
  '../../apps/web/src/features/curadoria/CuradoriaReviewPage.tsx',
  import.meta.url
);
const stylesPath = new URL('../../apps/web/src/styles.css', import.meta.url);

test('AvaliacaoCuradorPanel renderiza cabecalho institucional com autor, data/hora e badge de nota/aprovacao', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /avaliacao\.autor\.nome/,
    'AvaliacaoCuradorPanel deve renderizar o nome do Curador autor'
  );
  assert.match(
    code,
    /dateTime\.format\(new Date\(avaliacao\.criadoEm\)\)/,
    'AvaliacaoCuradorPanel deve formatar a data/hora de criacao'
  );
  assert.match(
    code,
    /avaliacao-heading/,
    'AvaliacaoCuradorPanel deve conter container avaliacao-heading'
  );
  assert.match(
    code,
    /avaliacao-score \$\{avaliacao\.aprovacao\}/,
    'AvaliacaoCuradorPanel deve aplicar a classe dinamica de aprovacao no badge de nota'
  );
  assert.match(
    code,
    /avaliacao\.aprovacao === 'aprovado' \? 'Aprovado' : 'Reprovado'/,
    'AvaliacaoCuradorPanel deve exibir o texto de status Aprovado ou Reprovado'
  );
});

test('AvaliacaoCuradorPanel exibe Nota da Avaliacao da IA, resumo, falhas e comentario da revisao', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /Nota da Avaliação da IA:/,
    'AvaliacaoCuradorPanel deve exibir o label Nota da Avaliação da IA'
  );
  assert.match(
    code,
    /avaliacao\.notaAvaliacaoIa\.toLocaleString\('pt-BR'\)/,
    'AvaliacaoCuradorPanel deve formatar a nota da avaliacao da IA'
  );
  assert.match(
    code,
    /avaliacao\.resumoAtendimento/,
    'AvaliacaoCuradorPanel deve renderizar o resumo do atendimento quando presente'
  );
  assert.match(
    code,
    /avaliacao\.falhasIdentificadas/,
    'AvaliacaoCuradorPanel deve renderizar as falhas identificadas'
  );
  assert.match(
    code,
    /Comentário da revisão/,
    'AvaliacaoCuradorPanel deve exibir o label Comentário da revisão'
  );
  assert.match(
    code,
    /avaliacao\.comentario/,
    'AvaliacaoCuradorPanel deve renderizar o texto do comentario'
  );
});

test('AvaliacaoCuradorPanel integra checklist com CriterionTooltip, badges criticos e classes semanticas', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /<CriterionTooltip/,
    'AvaliacaoCuradorPanel deve instanciar CriterionTooltip no checklist'
  );
  assert.match(
    code,
    /criterio-check criterio-\$\{criterio\.estado\}/,
    'AvaliacaoCuradorPanel deve aplicar classes semanticas conforme estado do criterio'
  );
  assert.match(
    code,
    /criterio\.critico \?/,
    'AvaliacaoCuradorPanel deve verificar se o criterio e critico'
  );
  assert.match(
    code,
    /critical-label/,
    'AvaliacaoCuradorPanel deve aplicar critical-label para criterios criticos'
  );
});

test('CriterionTooltip fornece suporte acessivel a hover, foco, role tooltip e escape', async () => {
  const code = await readFile(tooltipPath, 'utf8');

  assert.match(
    code,
    /criterion-tooltip-wrapper/,
    'CriterionTooltip deve ter container criterion-tooltip-wrapper'
  );
  assert.match(
    code,
    /criterion-tooltip-trigger/,
    'CriterionTooltip deve ter trigger criterion-tooltip-trigger'
  );
  assert.match(
    code,
    /tabIndex=\{0\}/,
    'CriterionTooltip deve ser focavel via tabIndex'
  );
  assert.match(
    code,
    /role="tooltip"/,
    'CriterionTooltip deve ter role="tooltip"'
  );
  assert.match(
    code,
    /onMouseEnter/,
    'CriterionTooltip deve abrir no mouseEnter'
  );
  assert.match(
    code,
    /onFocus/,
    'CriterionTooltip deve abrir no focus'
  );
  assert.match(
    code,
    /onMouseLeave/,
    'CriterionTooltip deve fechar no mouseLeave'
  );
  assert.match(
    code,
    /onBlur/,
    'CriterionTooltip deve fechar no blur'
  );
  assert.match(
    code,
    /e\.key === 'Escape'/,
    'CriterionTooltip deve fechar com a tecla Escape'
  );
});

test('CuradoriaReviewPage substitui bloco escuro legado e secao duplicada por AvaliacaoCuradorPanel', async () => {
  const code = await readFile(reviewPagePath, 'utf8');

  assert.doesNotMatch(
    code,
    /className="review-history"/,
    'CuradoriaReviewPage nao deve mais renderizar a secao .review-history'
  );
  assert.doesNotMatch(
    code,
    /Consulta somente leitura/,
    'CuradoriaReviewPage nao deve mais renderizar a secao Consulta somente leitura'
  );
  assert.match(
    code,
    /<AvaliacaoCuradorPanel/,
    'CuradoriaReviewPage deve renderizar AvaliacaoCuradorPanel para perfis de leitura (Admin e Gestao)'
  );
  assert.match(
    code,
    /emptyMessage="Ainda não há conferência do Curador para este Atendimento."/,
    'CuradoriaReviewPage deve fornecer mensagem institucional quando nao houver conferencia'
  );
});

test('styles.css mantem consistencia visual institucional do painel e do tooltip', async () => {
  const css = await readFile(stylesPath, 'utf8');

  // Identidade do card
  assert.match(
    css,
    /\.avaliacao-panel\s*\{[^}]*background:\s*rgb\(255\s+255\s+255\s*\/\s*76%\);[^}]*border-top:\s*6px\s+solid\s+#16816f;/s,
    'styles.css deve ter background translucido e borda superior #16816f para .avaliacao-panel'
  );
  assert.match(
    css,
    /\.avaliacao-heading\s+h2\s*\{[^}]*font-family:\s*Georgia/s,
    'styles.css deve usar tipografia Georgia no titulo do painel'
  );

  // Badges de aprovacao
  assert.match(
    css,
    /\.avaliacao-score\s*\{[^}]*background:\s*#16816f;/s,
    'styles.css deve usar verde #16816f para status aprovado'
  );
  assert.match(
    css,
    /\.avaliacao-score\.reprovado\s*\{[^}]*background:\s*#9f3f32;/s,
    'styles.css deve usar bordô #9f3f32 para status reprovado'
  );

  // Bordas semanticas do checklist
  assert.match(
    css,
    /\.criterio-check\s*\{[^}]*border-left:\s*5px\s+solid\s+#16816f;/s,
    'styles.css deve ter borda verde #16816f para criterios atendidos'
  );
  assert.match(
    css,
    /\.criterio-nao_atendido\s*\{[^}]*border-left-color:\s*#b95042;/s,
    'styles.css deve ter borda bordô #b95042 para criterios nao atendidos'
  );
  assert.match(
    css,
    /\.criterio-nao_se_aplica\s*\{[^}]*border-left-color:\s*#d39f37;/s,
    'styles.css deve ter borda âmbar #d39f37 para criterios nao se aplica'
  );

  // Tooltip
  assert.match(
    css,
    /\.criterion-tooltip\s*\{[^}]*position:\s*absolute;/s,
    'styles.css deve posicionar .criterion-tooltip de forma absoluta'
  );
  assert.match(
    css,
    /\.criterion-tooltip-trigger\s*\{[^}]*cursor:\s*help;/s,
    'styles.css deve exibir cursor help no trigger do tooltip'
  );
});
