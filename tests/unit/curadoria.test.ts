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
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$3/
  );
  assert.deepEqual(comMotivo.values, [
    '2025-01-01',
    '2025-01-31',
    'Rede credenciada'
  ]);

  const comMotivoNaoInformadoSemAcento = buildFilaCuradoriaFilters(
    {
      motivo: 'Nao informado'
    },
    1
  );
  assert.match(
    comMotivoNaoInformadoSemAcento.clauses.join(' and '),
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$1/
  );
  const comConversationId = buildFilaCuradoriaFilters(
    {
      conversationId: 'conv-fila-xyz'
    },
    1
  );
  assert.match(
    comConversationId.clauses.join(' and '),
    /a\.elevenlabs_conversation_id ilike '%' \|\| \$1 \|\| '%'/
  );
  assert.deepEqual(comConversationId.values, ['conv-fila-xyz']);
});

test('listDistinctMotivos retorna motivos distintos e ordenados incluindo Nao informado canônico', async () => {
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
          { motivo: 'Não informado' },
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
    'Não informado',
    'Rede credenciada'
  ]);
  assert.match(
    executedSql,
    /coalesce\(nullif\(nullif\(trim\(motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) as motivo/i
  );
  assert.match(executedSql, /order by motivo/i);
});

test('curadoresListSchema valida lista de curadores com id e nome', async () => {
  const { curadoresListSchema, curadorItemSchema } = await import(
    '../../packages/contracts/src/curadoria.js'
  );

  assert.equal(
    curadorItemSchema.safeParse({
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Caio Curador'
    }).success,
    true
  );

  assert.equal(
    curadoresListSchema.safeParse([
      { id: '33333333-3333-4333-8333-333333333333', nome: 'Caio Curador' },
      { id: '44444444-4444-4444-8444-444444444444', nome: 'Bruna Curadora' }
    ]).success,
    true
  );

  assert.equal(
    curadoresListSchema.safeParse([
      { id: 'invalido', nome: 'Invalido' }
    ]).success,
    false
  );
});

test('listCuradores retorna usuarios com papel curador ordenados por nome', async () => {
  const { createCuradoriaRepository } = await import(
    '../../apps/api/src/modules/curadoria/repository.js'
  );

  let executedSql = '';
  const mockDb = {
    async query(sql: string) {
      executedSql = sql;
      return {
        rows: [
          { id: '44444444-4444-4444-8444-444444444444', nome: 'Bruna Curadora' },
          { id: '33333333-3333-4333-8333-333333333333', nome: 'Caio Curador' }
        ]
      };
    }
  } as any;

  const repo = createCuradoriaRepository(mockDb);
  const curadores = await repo.listCuradores();
  assert.deepEqual(curadores, [
    { id: '44444444-4444-4444-8444-444444444444', nome: 'Bruna Curadora' },
    { id: '33333333-3333-4333-8333-333333333333', nome: 'Caio Curador' }
  ]);
  assert.match(executedSql, /papel = 'curador'/i);
  assert.match(executedSql, /order by lower\(nome\)/i);
});

test('curadoriasRealizadasQuerySchema valida filtros de periodo, motivo e curador', async () => {
  const { curadoriasRealizadasQuerySchema } = await import(
    '../../packages/contracts/src/curadoria.js'
  );

  const parsed = curadoriasRealizadasQuerySchema.parse({
    inicio: '2025-01-10',
    fim: '2025-01-20',
    motivo: 'Rede credenciada',
    curadorId: '33333333-3333-4333-8333-333333333333'
  });
  assert.deepEqual(parsed, {
    limit: 50,
    offset: 0,
    inicio: '2025-01-10',
    fim: '2025-01-20',
    motivo: 'Rede credenciada',
    curadorId: '33333333-3333-4333-8333-333333333333'
  });

  const diaUnico = curadoriasRealizadasQuerySchema.parse({
    inicio: '2025-01-15'
  });
  assert.equal(diaUnico.fim, '2025-01-15');

  assert.equal(
    curadoriasRealizadasQuerySchema.safeParse({ fim: '2025-01-15' }).success,
    false
  );
  assert.equal(
    curadoriasRealizadasQuerySchema.safeParse({
      inicio: '2025-01-20',
      fim: '2025-01-10'
    }).success,
    false
  );
});

test('curadoriasRealizadasPageSchema valida envelope de curadorias realizadas', async () => {
  const { curadoriasRealizadasPageSchema } = await import(
    '../../packages/contracts/src/curadoria.js'
  );

  const sample = {
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        conversationId: 'conv-123',
        agenteVozNome: 'Livia',
        concluidoEm: '2025-01-15T12:00:00.000Z',
        duracaoSegundos: 45,
        motivoContato: 'Rede credenciada',
        notaIa: 9.5,
        curadorId: '33333333-3333-4333-8333-333333333333',
        curadorNome: 'Caio Curador',
        notaCurador: 8.0,
        realizadaEm: '2025-01-15T14:00:00.000Z'
      }
    ],
    total: 1
  };

  const parsed = curadoriasRealizadasPageSchema.safeParse(sample);
  assert.equal(parsed.success, true);
});

test('buildCuradoriasRealizadasFilters aplica filtros de data, motivo e curadorId', async () => {
  const { buildCuradoriasRealizadasFilters } = await import(
    '../../apps/api/src/modules/curadoria/repository.js'
  );

  const filters = buildCuradoriasRealizadasFilters(
    {
      inicio: '2025-01-10',
      fim: '2025-01-20',
      motivo: 'Rede credenciada',
      curadorId: '33333333-3333-4333-8333-333333333333'
    },
    1
  );

  assert.match(
    filters.clauses.join(' and '),
    /a\.concluido_em at time zone 'America\/Sao_Paulo' >= \$1::date/
  );
  assert.match(
    filters.clauses.join(' and '),
    /a\.concluido_em at time zone 'America\/Sao_Paulo' < \$2::date \+ interval '1 day'/
  );
  assert.match(
    filters.clauses.join(' and '),
    /coalesce\(nullif\(nullif\(trim\(a\.motivo_contato\), ''\), 'Nao informado'\), 'Não informado'\) = \$3/
  );
  assert.match(
    filters.clauses.join(' and '),
    /cur\.autor_usuario_id = \$4::uuid/
  );
  assert.deepEqual(filters.values, [
    '2025-01-10',
    '2025-01-20',
    'Rede credenciada',
    '33333333-3333-4333-8333-333333333333'
  ]);

  const filtersWithConv = buildCuradoriasRealizadasFilters(
    {
      conversationId: 'conv-realizada-123'
    },
    1
  );
  assert.match(
    filtersWithConv.clauses.join(' and '),
    /a\.elevenlabs_conversation_id ilike '%' \|\| \$1 \|\| '%'/
  );
  assert.deepEqual(filtersWithConv.values, ['conv-realizada-123']);
});

test('buildCuradoriasRealizadasFilters suporta criteriosAtendidos e criteriosNaoAtendidos com conjuncao AND para Curador', async () => {
  const { buildCuradoriasRealizadasFilters } = await import(
    '../../apps/api/src/modules/curadoria/repository.js'
  );

  const filters = buildCuradoriasRealizadasFilters(
    {
      criteriosAtendidos: ['11111111-1111-4111-8111-111111111111'],
      criteriosNaoAtendidos: [
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333'
      ]
    },
    1
  );

  assert.equal(filters.clauses.length, 3);
  assert.match(
    filters.clauses[0]!,
    /acc\.avaliacao_curador_id = cur\.id\s+and\s+acc\.criterio_id = \$1::uuid\s+and\s+acc\.estado = 'atendido'/
  );
  assert.match(
    filters.clauses[1]!,
    /acc\.avaliacao_curador_id = cur\.id\s+and\s+acc\.criterio_id = \$2::uuid\s+and\s+acc\.estado = 'nao_atendido'/
  );
  assert.match(
    filters.clauses[2]!,
    /acc\.avaliacao_curador_id = cur\.id\s+and\s+acc\.criterio_id = \$3::uuid\s+and\s+acc\.estado = 'nao_atendido'/
  );
  assert.deepEqual(filters.values, [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  ]);
});


test('toCuradoriaRealizadaItem mapeia campos da linha do banco', async () => {
  const { toCuradoriaRealizadaItem } = await import(
    '../../apps/api/src/modules/curadoria/service.js'
  );

  const item = toCuradoriaRealizadaItem({
    id: '11111111-1111-4111-8111-111111111111',
    conversationId: 'conv-123',
    agenteVozNome: 'Livia',
    concluidoEm: new Date('2025-01-15T12:00:00.000Z'),
    duracaoSegundos: 45,
    motivoContato: 'Rede credenciada',
    notaIa: '9.50',
    curadorId: '33333333-3333-4333-8333-333333333333',
    curadorNome: 'Caio Curador',
    notaCurador: '8.00',
    realizadaEm: new Date('2025-01-15T14:00:00.000Z')
  });

  assert.deepEqual(item, {
    id: '11111111-1111-4111-8111-111111111111',
    conversationId: 'conv-123',
    agenteVozNome: 'Livia',
    concluidoEm: '2025-01-15T12:00:00.000Z',
    duracaoSegundos: 45,
    motivoContato: 'Rede credenciada',
    notaIa: 9.5,
    curadorId: '33333333-3333-4333-8333-333333333333',
    curadorNome: 'Caio Curador',
    notaCurador: 8.0,
    realizadaEm: '2025-01-15T14:00:00.000Z'
  });
});

test('criterioCuradoriaSchema valida descricao obrigatoria no contrato (string ou null)', async () => {
  const { criterioCuradoriaSchema } = await import(
    '../../packages/contracts/src/curadoria.js'
  );

  const comDescricao = {
    chave: 'saudacao_e_intencao',
    nome: 'Saudação e Intenção',
    descricao: 'Cumprimentou e identificou a intenção inicial do cliente?',
    estado: 'atendido' as const,
    valor: 1.0,
    critico: false,
    condicional: false,
    ordem: 1
  };
  const parsed = criterioCuradoriaSchema.parse(comDescricao);
  assert.equal(parsed.descricao, 'Cumprimentou e identificou a intenção inicial do cliente?');

  const comDescricaoNula = {
    ...comDescricao,
    descricao: null
  };
  const parsedNulo = criterioCuradoriaSchema.parse(comDescricaoNula);
  assert.equal(parsedNulo.descricao, null);
});

test('toCuradoriaDetail preserva descricao da Regua no checklist da IA e do Curador', async () => {
  const { toCuradoriaDetail } = await import(
    '../../apps/api/src/modules/curadoria/service.js'
  );

  const detail = toCuradoriaDetail(
    {
      id: '11111111-1111-4111-8111-111111111111',
      conversationId: 'conv-123',
      agenteVozId: '22222222-2222-4222-8222-222222222222',
      agenteVozNome: 'Livia',
      agentId: 'agent-livia',
      status: 'concluido',
      iniciadoEm: new Date('2025-01-15T12:00:00.000Z'),
      concluidoEm: new Date('2025-01-15T12:01:00.000Z'),
      duracaoSegundos: 60,
      motivoContato: 'Cancelamento',
      houveTransferencia: false,
      custo: null,
      eventTimestamp: null,
      curadorId: null,
      curadorNome: null,
      curadoriaNota: null,
      curadoriaRealizadaEm: null,
      transcricao: [],
      audioReference: null,
      avaliacaoIa: {
        id: '33333333-3333-4333-8333-333333333333',
        atendimentoId: '11111111-1111-4111-8111-111111111111',
        nota: '9.50',
        notaQualidade: '9.50',
        atendimentoAprovado: true,
        falhasIdentificadas: [],
        resumoAtendimento: 'Atendimento correto.',
        promptVersao: 1,
        criadoEm: new Date('2025-01-15T12:01:05.000Z'),
        saudacaoEIntencao: true,
        solicitouCpf: true,
        informouProtocoloEmail: true,
        resolveuSolicitacao: true,
        validouEmailPorExtenso: true,
        semDiminutivos: true,
        encerramentoGeap: true,
        usoCorretoFerramentas: true,
        checklist: [
          {
            criterioId: '44444444-4444-4444-8444-444444444444',
            chave: 'saudacao_e_intencao',
            nome: 'Saudação e Intenção',
            descricao: 'Cumprimentou e identificou a intenção inicial do cliente?',
            estado: 'atendido',
            valor: '1.00',
            critico: false,
            condicional: false,
            ordem: 1
          }
        ]
      },
      historico: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          atendimentoId: '11111111-1111-4111-8111-111111111111',
          avaliacaoIaId: '33333333-3333-4333-8333-333333333333',
          autorId: '66666666-6666-4666-8666-666666666666',
          autorNome: 'Caio Curador',
          nota: '9.50',
          falhasIdentificadas: [],
          resumoAtendimento: 'Conferido.',
          notaAvaliacaoIa: '9.50',
          comentario: null,
          criadoEm: new Date('2025-01-15T12:02:00.000Z'),
          checklist: [
            {
              criterioId: '44444444-4444-4444-8444-444444444444',
              chave: 'saudacao_e_intencao',
              nome: 'Saudação e Intenção',
              descricao: 'Cumprimentou e identificou a intenção inicial do cliente?',
              estado: 'atendido',
              valor: '1.00',
              critico: false,
              condicional: false,
              ordem: 1
            }
          ]
        }
      ]
    },
    null
  );

  assert.equal(
    detail.avaliacaoIa.checklist[0]?.descricao,
    'Cumprimentou e identificou a intenção inicial do cliente?'
  );
  assert.equal(
    detail.historico[0]?.checklist[0]?.descricao,
    'Cumprimentou e identificou a intenção inicial do cliente?'
  );
});

test('styles.css corrige layout de review-checklist legend e define tooltip flutuante', async () => {
  const fs = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const cssPath = fileURLToPath(
    new URL('../../apps/web/src/styles.css', import.meta.url)
  );
  const css = await fs.readFile(cssPath, 'utf8');

  // Deve usar display: contents no legend e flex no wrapper interno para manter legend e options lado a lado no grid
  assert.match(
    css,
    /\.review-checklist\s+legend\s*\{[^}]*display:\s*contents/s,
    'review-checklist legend deve usar display: contents'
  );
  assert.match(
    css,
    /\.criterion-legend-content\s*\{[^}]*display:\s*(inline-flex|flex)/s,
    'criterion-legend-content deve usar flex/inline-flex para agrupar nome e tag critico'
  );
  // Deve ter estilos para o custom tooltip e seu indicador de seta
  assert.match(css, /\.criterion-tooltip\b/);
  assert.match(css, /\.criterion-tooltip-arrow\b/);
});



