import assert from 'node:assert/strict';
import test from 'node:test';
import {
  avaliacaoIaResponseSchema,
  avaliacaoIaSchema
} from '../../packages/contracts/src/avaliacoes.js';

const id = '11111111-1111-4111-8111-111111111111';
const atendimentoId = '22222222-2222-4222-8222-222222222222';

const checklistBooleano = {
  saudacao_e_intencao: true,
  solicitou_cpf: true,
  informou_protocolo_email: true,
  resolveu_solicitacao: true,
  validou_email_por_extenso: true,
  sem_diminutivos: false,
  encerramento_geap: true,
  uso_correto_ferramentas: true
};

const criterios = [
  {
    chave: 'saudacao_e_intencao',
    nome: 'Saudação e Intenção',
    atendido: true,
    valor: 1,
    critico: false,
    ordem: 1
  },
  {
    chave: 'sem_diminutivos',
    nome: 'Ausência de Diminutivos',
    atendido: false,
    valor: 0.5,
    critico: false,
    ordem: 6
  }
];

test('contrato da Avaliacao da IA expoe checklist booleano, claims e snapshot', () => {
  const parsed = avaliacaoIaSchema.parse({
    id,
    atendimentoId,
    nota: 9.5,
    aprovacao: 'aprovado',
    notaQualidade: 9.5,
    atendimentoAprovado: true,
    falhasIdentificadas: ['Usou um diminutivo durante o contato.'],
    resumoAtendimento: 'Cliente solicitou a segunda via e recebeu o boleto.',
    promptVersao: 3,
    criadoEm: '2026-07-31T12:00:00.000Z',
    checklist: checklistBooleano,
    criterios
  });

  assert.equal(parsed.nota, 9.5);
  assert.equal(parsed.aprovacao, 'aprovado');
  assert.equal(parsed.notaQualidade, 9.5);
  assert.equal(parsed.atendimentoAprovado, true);
  assert.deepEqual(parsed.checklist, checklistBooleano);
  assert.equal(parsed.checklist.uso_correto_ferramentas, true);
  assert.equal(parsed.criterios[1]?.atendido, false);
});

test('contrato rejeita checklist sem uso_correto_ferramentas', () => {
  const { uso_correto_ferramentas: _omitida, ...semFerramentas } = checklistBooleano;
  assert.equal(
    avaliacaoIaSchema.safeParse({
      id,
      atendimentoId,
      nota: 9.5,
      aprovacao: 'aprovado',
      notaQualidade: 9.5,
      atendimentoAprovado: true,
      falhasIdentificadas: [],
      resumoAtendimento: null,
      promptVersao: 3,
      criadoEm: '2026-07-31T12:00:00.000Z',
      checklist: semFerramentas,
      criterios
    }).success,
    false
  );
});

test('contrato rejeita checklist com estados ternarios da Regua antiga', () => {
  assert.equal(
    avaliacaoIaSchema.safeParse({
      id,
      atendimentoId,
      nota: 9.5,
      aprovacao: 'aprovado',
      notaQualidade: 9.5,
      atendimentoAprovado: true,
      falhasIdentificadas: [],
      resumoAtendimento: null,
      promptVersao: 3,
      criadoEm: '2026-07-31T12:00:00.000Z',
      checklist: [
        {
          chave: 'saudacao_e_intencao',
          nome: 'Saudação e Intenção',
          estado: 'atendido',
          valor: 1,
          critico: false,
          ordem: 1
        }
      ],
      criterios
    }).success,
    false
  );
});

test('leitura HTTP nula continua valida', () => {
  assert.equal(avaliacaoIaResponseSchema.parse(null), null);
});
