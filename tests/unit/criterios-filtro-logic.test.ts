import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  formatSelectedCriteriaLabel,
  parseCriteriaParam
} from '../../apps/web/src/features/atendimentos/criterios-filtro-logic.js';

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

const criteriosSample = [
  { id: UUID_1, nome: 'Saudação e Apresentação' },
  { id: UUID_2, nome: 'Identificação do Beneficiário' },
  { id: UUID_3, nome: 'Resolução da Demanda' }
];

test('parseCriteriaParam lida com parametro ausente, vazio, virgulas e repeticoes', () => {
  const emptyParams = new URLSearchParams();
  assert.deepEqual(parseCriteriaParam(emptyParams, 'criteriosAtendidos'), []);

  const commaParams = new URLSearchParams(`criteriosAtendidos=${UUID_1},${UUID_2}`);
  assert.deepEqual(parseCriteriaParam(commaParams, 'criteriosAtendidos'), [UUID_1, UUID_2]);

  const repeatedParams = new URLSearchParams();
  repeatedParams.append('criteriosAtendidos', UUID_1);
  repeatedParams.append('criteriosAtendidos', UUID_3);
  assert.deepEqual(parseCriteriaParam(repeatedParams, 'criteriosAtendidos'), [UUID_1, UUID_3]);

  const mixedDuplicateParams = new URLSearchParams();
  mixedDuplicateParams.append('criteriosNaoAtendidos', `${UUID_1}, ${UUID_2}`);
  mixedDuplicateParams.append('criteriosNaoAtendidos', ` ${UUID_1} `);
  assert.deepEqual(parseCriteriaParam(mixedDuplicateParams, 'criteriosNaoAtendidos'), [UUID_1, UUID_2]);
});

test('formatSelectedCriteriaLabel formata placeholder, nome individual e contagem', () => {
  assert.equal(
    formatSelectedCriteriaLabel([], criteriosSample, 'Nenhum critério'),
    'Nenhum critério'
  );

  assert.equal(
    formatSelectedCriteriaLabel([UUID_1], criteriosSample),
    'Saudação e Apresentação'
  );

  assert.equal(
    formatSelectedCriteriaLabel([UUID_1, UUID_2], criteriosSample),
    '2 selecionados'
  );

  assert.equal(
    formatSelectedCriteriaLabel([UUID_1, UUID_2, UUID_3], criteriosSample),
    '3 selecionados'
  );
});

test('CriteriosMultiSelect e instanciado em AtendimentosPage e CuradoriasRealizadasPage', async () => {
  const atendimentosUrl = new URL(
    '../../apps/web/src/features/atendimentos/AtendimentosPage.tsx',
    import.meta.url
  );
  const atendimentosContent = await readFile(atendimentosUrl, 'utf-8');
  assert.match(atendimentosContent, /<CriteriosMultiSelect/);
  assert.match(atendimentosContent, /id="atendimentos-criterios-nao-atendidos-filtro"/);
  assert.match(atendimentosContent, /id="atendimentos-criterios-atendidos-filtro"/);

  const curadoriasUrl = new URL(
    '../../apps/web/src/features/curadoria/CuradoriasRealizadasPage.tsx',
    import.meta.url
  );
  const curadoriasContent = await readFile(curadoriasUrl, 'utf-8');
  assert.match(curadoriasContent, /<CriteriosMultiSelect/);
  assert.match(curadoriasContent, /id="curadorias-criterios-nao-atendidos-filtro"/);
  assert.match(curadoriasContent, /id="curadorias-criterios-atendidos-filtro"/);
});

test('styles.css define estilos para CriteriosMultiSelect', async () => {
  const stylesUrl = new URL('../../apps/web/src/styles.css', import.meta.url);
  const stylesContent = await readFile(stylesUrl, 'utf-8');
  assert.match(stylesContent, /\.criterios-multiselect-wrapper/);
  assert.match(stylesContent, /\.criterios-multiselect-trigger/);
  assert.match(stylesContent, /\.criterios-multiselect-popover/);
  assert.match(stylesContent, /\.criterios-multiselect-option/);
});

