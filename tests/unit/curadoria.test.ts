import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularConferencia } from '../../apps/api/src/modules/curadoria/service.js';

const checklistIa = [
  {
    criterioId: '11111111-1111-4111-8111-111111111111',
    chave: 'saudacao',
    nome: 'Saudacao',
    estado: 'atendido' as const,
    valor: '2.00',
    critico: false,
    condicional: false,
    ordem: 1
  },
  {
    criterioId: '22222222-2222-4222-8222-222222222222',
    chave: 'protocolo',
    nome: 'Protocolo',
    estado: 'atendido' as const,
    valor: '8.00',
    critico: true,
    condicional: true,
    ordem: 2
  }
];

test('conferencia recalcula nota e aprovacao com os valores do snapshot da IA', () => {
  const result = calcularConferencia(checklistIa, [
    { chave: 'saudacao', estado: 'nao_atendido' },
    { chave: 'protocolo', estado: 'nao_se_aplica' }
  ]);

  assert.equal(result.nota, 8);
  assert.equal(result.aprovacao, 'aprovado');
  assert.deepEqual(
    result.checklist.map(({ chave, estado }) => ({ chave, estado })),
    [
      { chave: 'saudacao', estado: 'nao_atendido' },
      { chave: 'protocolo', estado: 'nao_se_aplica' }
    ]
  );
});

test('conferencia rejeita checklist diferente do snapshot da IA', () => {
  assert.throws(
    () => calcularConferencia(checklistIa, [
      { chave: 'saudacao', estado: 'atendido' }
    ]),
    /todos os Criterios/i
  );

  assert.throws(
    () => calcularConferencia(checklistIa, [
      { chave: 'saudacao', estado: 'atendido' },
      { chave: 'saudacao', estado: 'nao_atendido' }
    ]),
    /todos os Criterios/i
  );
});

test('conferencia aceita nao se aplica apenas em Criterio condicional', () => {
  assert.throws(
    () => calcularConferencia(checklistIa, [
      { chave: 'saudacao', estado: 'nao_se_aplica' },
      { chave: 'protocolo', estado: 'atendido' }
    ]),
    /condicional/i
  );
});
