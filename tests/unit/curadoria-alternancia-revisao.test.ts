import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getInitialReviewFormState,
  shouldShowReadingCardFirst
} from '../../apps/web/src/features/curadoria/curadoria-review-logic.js';

const reviewPagePath = new URL(
  '../../apps/web/src/features/curadoria/CuradoriaReviewPage.tsx',
  import.meta.url
);
const curadorPanelPath = new URL(
  '../../apps/web/src/features/avaliacoes/AvaliacaoCuradorPanel.tsx',
  import.meta.url
);
const stylesPath = new URL('../../apps/web/src/styles.css', import.meta.url);

const mockAvaliacaoIa = {
  id: 'ia-11111111-1111-4111-8111-111111111111',
  atendimentoId: 'at-11111111-1111-4111-8111-111111111111',
  nota: 9.5,
  notaQualidade: 9.5,
  aprovacao: 'aprovado' as const,
  atendimentoAprovado: true,
  falhasIdentificadas: ['Falha identificada pela IA'],
  resumoAtendimento: 'Resumo original da IA',
  criadoEm: '2025-01-15T12:00:00.000Z',
  checklist: [
    {
      chave: 'saudacao_e_intencao',
      nome: 'Saudação e Intenção',
      descricao: 'Descrição saudação',
      estado: 'atendido' as const,
      valor: 1.0,
      critico: false,
      condicional: false,
      ordem: 1
    },
    {
      chave: 'informou_protocolo_email',
      nome: 'Informação de Protocolo',
      descricao: 'Descrição protocolo',
      estado: 'atendido' as const,
      valor: 1.0,
      critico: true,
      condicional: false,
      ordem: 2
    },
    {
      chave: 'resolveu_solicitacao',
      nome: 'Resolução da Solicitação',
      descricao: 'Descrição resolução',
      estado: 'atendido' as const,
      valor: 3.0,
      critico: false,
      condicional: false,
      ordem: 3
    },
    {
      chave: 'uso_correto_ferramentas',
      nome: 'Uso Correto de Ferramentas',
      descricao: 'Descrição ferramentas',
      estado: 'atendido' as const,
      valor: 0.0,
      critico: false,
      condicional: false,
      ordem: 4
    }
  ]
};

const mockAvaliacaoCurador = {
  id: 'cur-22222222-2222-4222-8222-222222222222',
  atendimentoId: 'at-11111111-1111-4111-8111-111111111111',
  avaliacaoIaId: 'ia-11111111-1111-4111-8111-111111111111',
  autor: { id: 'user-1', nome: 'Caio Curador' },
  nota: 7.0,
  aprovacao: 'reprovado' as const,
  notaAvaliacaoIa: 4.5,
  falhasIdentificadas: ['Protocolo não informado', 'Erro em procedimento'],
  resumoAtendimento: 'Resumo editado pelo curador',
  comentario: 'Comentário da revisão anterior do curador',
  criadoEm: '2025-01-15T14:00:00.000Z',
  checklist: [
    {
      chave: 'saudacao_e_intencao',
      nome: 'Saudação e Intenção',
      descricao: 'Descrição saudação',
      estado: 'atendido' as const,
      valor: 1.0,
      critico: false,
      condicional: false,
      ordem: 1
    },
    {
      chave: 'informou_protocolo_email',
      nome: 'Informação de Protocolo',
      descricao: 'Descrição protocolo',
      estado: 'nao_atendido' as const,
      valor: 1.0,
      critico: true,
      condicional: false,
      ordem: 2
    },
    {
      chave: 'resolveu_solicitacao',
      nome: 'Resolução da Solicitação',
      descricao: 'Descrição resolução',
      estado: 'atendido' as const,
      valor: 3.0,
      critico: false,
      condicional: false,
      ordem: 3
    },
    {
      chave: 'uso_correto_ferramentas',
      nome: 'Uso Correto de Ferramentas',
      descricao: 'Descrição ferramentas',
      estado: 'atendido' as const,
      valor: 0.0,
      critico: false,
      condicional: false,
      ordem: 4
    }
  ]
};

test('shouldShowReadingCardFirst decide exibicao inicial conforme papel e presenca de revisao', () => {
  // Curador acessando atendimento sem conferencia: vai direto para o formulario
  assert.equal(shouldShowReadingCardFirst('curador', null), false);
  assert.equal(shouldShowReadingCardFirst('admin', null), false);

  // Curador acessando atendimento ja conferido: exibe card de leitura primeiro
  assert.equal(shouldShowReadingCardFirst('curador', mockAvaliacaoCurador), true);
  assert.equal(shouldShowReadingCardFirst('admin', mockAvaliacaoCurador), true);

  // Gestao acessando qualquer atendimento: sempre em modo leitura
  assert.equal(shouldShowReadingCardFirst('gestao', null), true);
  assert.equal(shouldShowReadingCardFirst('gestao', mockAvaliacaoCurador), true);
});

test('getInitialReviewFormState pre-preenche com dados da IA quando nao ha revisao anterior', () => {
  const state = getInitialReviewFormState(mockAvaliacaoIa, null);

  assert.deepEqual(state.estados, {
    saudacao_e_intencao: 'atendido',
    informou_protocolo_email: 'atendido',
    resolveu_solicitacao: 'atendido',
    uso_correto_ferramentas: 'atendido'
  });
  assert.equal(state.notaAvaliacaoIa, '9.5');
  assert.equal(state.falhasIdentificadas, 'Falha identificada pela IA');
  assert.equal(state.resumoAtendimento, 'Resumo original da IA');
  assert.equal(state.comentario, '');
});

test('getInitialReviewFormState pre-preenche com todos os dados da revisao mais recente no re-review', () => {
  const state = getInitialReviewFormState(mockAvaliacaoIa, mockAvaliacaoCurador);

  assert.deepEqual(state.estados, {
    saudacao_e_intencao: 'atendido',
    informou_protocolo_email: 'nao_atendido',
    resolveu_solicitacao: 'atendido',
    uso_correto_ferramentas: 'atendido'
  });
  assert.equal(state.notaAvaliacaoIa, '4.5');
  assert.equal(
    state.falhasIdentificadas,
    'Protocolo não informado\nErro em procedimento'
  );
  assert.equal(state.resumoAtendimento, 'Resumo editado pelo curador');
  assert.equal(state.comentario, 'Comentário da revisão anterior do curador');
});

test('CuradoriaReviewPage implementa alternancia entre card de leitura e formulario de reavaliacao', async () => {
  const code = await readFile(reviewPagePath, 'utf8');

  // Verifica suporte a estado de revisao / alternancia
  assert.match(
    code,
    /isRevising|setIsRevising|mode|setMode/,
    'CuradoriaReviewPage deve gerenciar estado para alternar entre leitura e formulario'
  );

  // Verifica presenca do botao "Fazer nova revisão" no modo leitura para o Curador
  assert.match(
    code,
    /Fazer nova revisão/,
    'CuradoriaReviewPage deve renderizar botao "Fazer nova revisão" quando Curador visualiza card de leitura'
  );

  // Verifica presenca do botao "Cancelar reavaliação" no ReviewForm
  assert.match(
    code,
    /Cancelar reavaliação/,
    'ReviewForm deve renderizar botao "Cancelar reavaliação" durante o re-review'
  );

  // Verifica passagem de initialData ou integracao com getInitialReviewFormState
  assert.match(
    code,
    /initialData|avaliacaoMaisRecente|getInitialReviewFormState/,
    'ReviewForm deve receber dados da avaliacao mais recente para pre-preenchimento'
  );
});

test('AvaliacaoCuradorPanel suporta prop action e renderiza container avaliacao-actions', async () => {
  const code = await readFile(curadorPanelPath, 'utf8');

  assert.match(
    code,
    /action\?:|action/,
    'AvaliacaoCuradorPanel / AvaliacaoCuradorCard deve aceitar prop action'
  );
  assert.match(
    code,
    /avaliacao-actions/,
    'AvaliacaoCuradorCard deve renderizar container .avaliacao-actions quando action for informada'
  );
});

test('styles.css define estilos para avaliacao-actions e secondary-action', async () => {
  const css = await readFile(stylesPath, 'utf8');

  assert.match(
    css,
    /\.avaliacao-actions\s*\{/,
    'styles.css deve definir regra para .avaliacao-actions'
  );
  assert.match(
    css,
    /\.secondary-action\s*\{/,
    'styles.css deve definir regra para .secondary-action'
  );
});
