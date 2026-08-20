import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MOTIVO_NAO_INFORMADO } from '../../packages/contracts/src/atendimentos.js';

test('constante canonica MOTIVO_NAO_INFORMADO e Não informado', () => {
  assert.equal(MOTIVO_NAO_INFORMADO, 'Não informado');
});

test('filterMotivoOptions suporta busca insensivel a acentos e maiusculas', async () => {
  const { filterMotivoOptions } = await import(
    '../../apps/web/src/features/atendimentos/motivo-combobox-logic.js'
  );

  const options = ['Cancelamento', 'Financeiro/Boletos', 'Não informado', 'Rede credenciada'];

  // Busca vazia retorna todas as opcoes
  assert.deepEqual(filterMotivoOptions(options, ''), options);
  assert.deepEqual(filterMotivoOptions(options, '   '), options);

  // Busca "nao" sem acento encontra "Não informado"
  assert.deepEqual(filterMotivoOptions(options, 'nao'), ['Não informado']);

  // Busca "não" com acento encontra "Não informado"
  assert.deepEqual(filterMotivoOptions(options, 'não'), ['Não informado']);

  // Busca "informado" encontra "Não informado"
  assert.deepEqual(filterMotivoOptions(options, 'informado'), ['Não informado']);

  // Busca "rede" encontra "Rede credenciada"
  assert.deepEqual(filterMotivoOptions(options, 'rede'), ['Rede credenciada']);

  // Busca inexistente retorna array vazio
  assert.deepEqual(filterMotivoOptions(options, 'inexistente'), []);
});

test('formatMotivoContato normaliza null, vazio e Nao informado legado para Não informado canonico', async () => {
  const { formatMotivoContato } = await import(
    '../../apps/web/src/features/atendimentos/motivo-combobox-logic.js'
  );

  assert.equal(formatMotivoContato(null), 'Não informado');
  assert.equal(formatMotivoContato(undefined), 'Não informado');
  assert.equal(formatMotivoContato(''), 'Não informado');
  assert.equal(formatMotivoContato('   '), 'Não informado');
  assert.equal(formatMotivoContato('Nao informado'), 'Não informado');
  assert.equal(formatMotivoContato('Não informado'), 'Não informado');
  assert.equal(formatMotivoContato('Cancelamento'), 'Cancelamento');
  assert.equal(formatMotivoContato('  Financeiro/Boletos  '), 'Financeiro/Boletos');
});

test('telas e detalhes exibem canonicamente Não informado com acento sem residuos legados', async () => {
  const filesToCheck = [
    '../../apps/web/src/features/atendimentos/AtendimentosPage.tsx',
    '../../apps/web/src/features/atendimentos/AtendimentoPage.tsx',
    '../../apps/web/src/features/curadoria/FilaCuradoriaPage.tsx',
    '../../apps/web/src/features/curadoria/CuradoriasRealizadasPage.tsx',
    '../../apps/web/src/features/curadoria/CuradoriaReviewPage.tsx',
    '../../apps/web/src/features/dashboards/DashboardPage.tsx'
  ];

  for (const relPath of filesToCheck) {
    const fileUrl = new URL(relPath, import.meta.url);
    const content = await readFile(fileUrl, 'utf-8');

    // Nao pode conter "Motivo não informado" nem "Nao informado" sem acento
    assert.equal(
      content.includes('Motivo não informado'),
      false,
      `${relPath} nao deve conter 'Motivo não informado'`
    );
    assert.equal(
      content.includes("'Nao informado'"),
      false,
      `${relPath} nao deve conter 'Nao informado' sem acento`
    );
    // Deve formatar com formatMotivoContato ou exibir 'Não informado'
    assert.equal(
      content.includes('formatMotivoContato') || content.includes('Não informado'),
      true,
      `${relPath} deve utilizar formatMotivoContato ou exibir 'Não informado' com acento`
    );
  }
});

test('MotivoCombobox e instanciado em Atendimentos, FilaCuradoria e CuradoriasRealizadas', async () => {
  const pages = [
    '../../apps/web/src/features/atendimentos/AtendimentosPage.tsx',
    '../../apps/web/src/features/curadoria/FilaCuradoriaPage.tsx',
    '../../apps/web/src/features/curadoria/CuradoriasRealizadasPage.tsx'
  ];

  for (const relPath of pages) {
    const fileUrl = new URL(relPath, import.meta.url);
    const content = await readFile(fileUrl, 'utf-8');
    assert.match(content, /<MotivoCombobox/);
  }
});
