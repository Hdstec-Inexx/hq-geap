import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  concordanciaChartSeries,
  criteriosChartSeries,
  motivosChartSeries
} from '../../apps/web/src/features/dashboards/chartSeries.js';

test('motivosChartSeries preserva labels e totais da API', () => {
  const series = motivosChartSeries([
    { motivo: 'Financeiro / Boletos', total: 3 },
    { motivo: 'Rede credenciada', total: 1 }
  ]);

  assert.deepEqual(series.labels, ['Financeiro / Boletos', 'Rede credenciada']);
  assert.deepEqual(series.values, [3, 1]);
});

test('criteriosChartSeries preserva percentualAcerto inclusive null', () => {
  const series = criteriosChartSeries([
    {
      criterioId: '11111111-1111-1111-1111-111111111111',
      chave: 'saudacao_e_intencao',
      nome: 'Saudação e Intenção',
      atendidos: 2,
      avaliados: 2,
      percentualAcerto: 100
    },
    {
      criterioId: '22222222-2222-2222-2222-222222222222',
      chave: 'validou_email_por_extenso',
      nome: 'Validou E-mail',
      atendidos: 0,
      avaliados: 0,
      percentualAcerto: null
    }
  ]);

  assert.deepEqual(series.labels, ['Saudação e Intenção', 'Validou E-mail']);
  assert.deepEqual(series.values, [100, null]);
});

test('concordanciaChartSeries preserva percentual por Critério inclusive null', () => {
  const series = concordanciaChartSeries([
    {
      criterioId: '11111111-1111-1111-1111-111111111111',
      chave: 'saudacao_e_intencao',
      nome: 'Saudação e Intenção',
      concordantes: 1,
      total: 2,
      percentual: 50
    },
    {
      criterioId: '22222222-2222-2222-2222-222222222222',
      chave: 'validou_email_por_extenso',
      nome: 'Validou E-mail',
      concordantes: 0,
      total: 0,
      percentual: null
    }
  ]);

  assert.deepEqual(series.labels, ['Saudação e Intenção', 'Validou E-mail']);
  assert.deepEqual(series.values, [50, null]);
});
