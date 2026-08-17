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

const checklistComFerramentas = [
  {
    criterioId: '33333333-3333-4333-8333-333333333333',
    chave: 'resolveu_solicitacao',
    nome: 'Resolucao da Solicitacao',
    estado: 'atendido' as const,
    valor: '3.00',
    critico: false,
    condicional: false,
    ordem: 1
  },
  {
    criterioId: '44444444-4444-4444-8444-444444444444',
    chave: 'uso_correto_ferramentas',
    nome: 'Uso Correto de Ferramentas',
    estado: 'atendido' as const,
    valor: '0.00',
    critico: false,
    condicional: false,
    ordem: 2
  },
  {
    criterioId: '55555555-5555-4555-8555-555555555555',
    chave: 'saudacao_e_intencao',
    nome: 'Saudacao',
    estado: 'atendido' as const,
    valor: '7.00',
    critico: false,
    condicional: false,
    ordem: 3
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

test('gate: ferramentas nao atendidas forca resolucao nao atendida e perde 3 pontos', () => {
  const result = calcularConferencia(checklistComFerramentas, [
    { chave: 'resolveu_solicitacao', estado: 'atendido' },
    { chave: 'uso_correto_ferramentas', estado: 'nao_atendido' },
    { chave: 'saudacao_e_intencao', estado: 'atendido' }
  ]);

  assert.equal(result.nota, 7);
  assert.deepEqual(
    result.checklist.map(({ chave, estado }) => ({ chave, estado })),
    [
      { chave: 'resolveu_solicitacao', estado: 'nao_atendido' },
      { chave: 'uso_correto_ferramentas', estado: 'nao_atendido' },
      { chave: 'saudacao_e_intencao', estado: 'atendido' }
    ]
  );
});

test('filtros da Fila de Curadoria fixam dia civil America/Sao_Paulo e motivo', async () => {
  const { buildFilaCuradoriaFilters } = await import(
    '../../apps/api/src/modules/curadoria/repository.js'
  );

  const diaUnico = buildFilaCuradoriaFilters(
    { inicio: '2025-01-15', fim: '2025-01-15' },
    3
  );
  assert.match(
    diaUnico.clauses.join(' and '),
    /a\.concluido_em at time zone 'America\/Sao_Paulo' >= \$3::date/
  );
  assert.match(
    diaUnico.clauses.join(' and '),
    /a\.concluido_em at time zone 'America\/Sao_Paulo' < \$4::date \+ interval '1 day'/
  );
  assert.deepEqual(diaUnico.values, ['2025-01-15', '2025-01-15']);

  const periodo = buildFilaCuradoriaFilters(
    { inicio: '2025-01-01', fim: '2025-01-31' },
    1
  );
  assert.deepEqual(periodo.values, ['2025-01-01', '2025-01-31']);

  const comMotivo = buildFilaCuradoriaFilters(
    {
      inicio: '2025-01-01',
      fim: '2025-01-31',
      motivo: 'Rede credenciada'
    },
    1
  );
  assert.match(
    comMotivo.clauses.join(' and '),
    /coalesce\(a\.motivo_contato, 'Nao informado'\) = \$3/
  );
  assert.deepEqual(comMotivo.values, [
    '2025-01-01',
    '2025-01-31',
    'Rede credenciada'
  ]);
});

test('listDistinctMotivos retorna motivos distintos e ordenados', async () => {
  const { createAtendimentosRepository } = await import(
    '../../apps/api/src/modules/atendimentos/repository.js'
  );

  let executedSql = '';
  const mockDb = {
    async query(sql: string) {
      executedSql = sql;
      return {
        rows: [
          { motivo: 'Cancelamento' },
          { motivo: 'Financeiro/Boletos' },
          { motivo: 'Rede credenciada' }
        ]
      };
    }
  } as any;

  const repo = createAtendimentosRepository(mockDb);
  const motivos = await repo.listDistinctMotivos();
  assert.deepEqual(motivos, [
    'Cancelamento',
    'Financeiro/Boletos',
    'Rede credenciada'
  ]);
  assert.match(executedSql, /distinct motivo_contato/i);
  assert.match(executedSql, /order by motivo_contato/i);
});
