import assert from 'node:assert/strict';
import test from 'node:test';
import { areasPorPapel } from '../../apps/web/src/app/casca-areas.js';

test('Curador vê Atendimentos, Monitoramento ao Vivo e Fila de Curadoria', () => {
  assert.deepEqual(
    areasPorPapel('curador').map((area) => area.label),
    [
      'Consultar Atendimentos',
      'Monitoramento ao Vivo',
      'Abrir Fila de Curadoria'
    ]
  );
});

test('Gestão vê Dashboard e as áreas do Curador, com Fila em wording de consulta', () => {
  assert.deepEqual(
    areasPorPapel('gestao').map((area) => area.label),
    [
      'Abrir Dashboard da Gestão',
      'Consultar Atendimentos',
      'Monitoramento ao Vivo',
      'Consultar Fila de Curadoria'
    ]
  );
});

test('Admin vê as áreas da Gestão mais manutenção, usuários, IA e Régua', () => {
  assert.deepEqual(
    areasPorPapel('admin').map((area) => area.label),
    [
      'Abrir Dashboard da Gestão',
      'Consultar Atendimentos',
      'Monitoramento ao Vivo',
      'Abrir Fila de Curadoria',
      'Trabalhar fila de manutenção',
      'Administrar usuários',
      'Configurar IA Avaliadora',
      'Consultar Régua de Avaliação'
    ]
  );
});

test('áreas apontam para as rotas já usadas pela Home antiga', () => {
  assert.deepEqual(
    areasPorPapel('admin').map((area) => area.to),
    [
      '/dashboard',
      '/atendimentos',
      '/monitoramento',
      '/curadoria',
      '/admin/comentarios',
      '/admin/usuarios',
      '/admin/configuracao-ia',
      '/admin/criterios'
    ]
  );
});
