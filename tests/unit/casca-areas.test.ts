import assert from 'node:assert/strict';
import test from 'node:test';
import { areasPorPapel } from '../../apps/web/src/app/casca-areas.js';

test('Curador vê Atendimentos, Monitoramento ao Vivo, Fila de Curadoria e Minhas Curadorias', () => {
  assert.deepEqual(
    areasPorPapel('curador').map((area) => area.label),
    [
      'Consultar Atendimentos',
      'Monitoramento ao Vivo',
      'Abrir Fila de Curadoria',
      'Minhas Curadorias'
    ]
  );
});

test('Gestão vê Dashboard, Atendimentos, Monitoramento ao Vivo, Fila de Curadoria e Curadorias Realizadas', () => {
  assert.deepEqual(
    areasPorPapel('gestao').map((area) => area.label),
    [
      'Abrir Dashboard da Gestão',
      'Consultar Atendimentos',
      'Monitoramento ao Vivo',
      'Consultar Fila de Curadoria',
      'Curadorias Realizadas'
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
      'Curadorias Realizadas',
      'Trabalhar fila de manutenção',
      'Administrar usuários',
      'Configurar IA Avaliadora',
      'Consultar Régua de Avaliação'
    ]
  );
});

test('áreas apontam para as rotas correspondentes', () => {
  assert.deepEqual(
    areasPorPapel('admin').map((area) => area.to),
    [
      '/dashboard',
      '/atendimentos',
      '/monitoramento',
      '/curadoria',
      '/curadorias-realizadas',
      '/admin/comentarios',
      '/admin/usuarios',
      '/admin/configuracao-ia',
      '/admin/criterios'
    ]
  );

  assert.deepEqual(
    areasPorPapel('curador').map((area) => area.to),
    [
      '/atendimentos',
      '/monitoramento',
      '/curadoria',
      '/minhas-curadorias'
    ]
  );
});

