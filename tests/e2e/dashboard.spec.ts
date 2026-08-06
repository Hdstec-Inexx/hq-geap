import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';
import { authUsers } from '../support/auth-fixtures.js';

const apiUrl = 'http://127.0.0.1:3000';
const { Client } = pg;

async function queryDatabase<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  const client = new Client({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test'
  });
  await client.connect();
  try {
    return await client.query<T>(text, values);
  } finally {
    await client.end();
  }
}

async function loginApi(
  request: APIRequestContext,
  role: 'admin' | 'gestao' | 'curador'
) {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  return (await response.json()) as { token: string };
}

async function loginPage(page: Page, role: 'admin' | 'gestao') {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/');
}

async function createDashboardAtendimento(input: {
  conversationId: string;
  concluidoEm: string;
  duracao: number;
  motivo: string;
  transferencia: boolean;
  custo: number;
  notaIa: number;
  notaCurador?: number;
  estadoIa: 'atendido' | 'nao_atendido' | 'nao_se_aplica';
  estadoCurador?: 'atendido' | 'nao_atendido' | 'nao_se_aplica';
}) {
  const atendimento = await queryDatabase<{ id: string }>(`
    insert into atendimentos (
      agente_voz_id, elevenlabs_conversation_id, status, concluido_em,
      duracao_segundos, motivo_contato, houve_transferencia, custo
    )
    select id, $1, 'concluido', $2, $3, $4, $5, $6
    from agentes_voz
    where elevenlabs_agent_id = 'agent-dashboard'
    returning id
  `, [
    input.conversationId,
    input.concluidoEm,
    input.duracao,
    input.motivo,
    input.transferencia,
    input.custo
  ]);
  const atendimentoId = atendimento.rows[0]!.id;
  const ia = await queryDatabase<{ id: string }>(`
    insert into avaliacoes (
      atendimento_id, autor, prompt_id, nota,
      saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
      resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
      encerramento_geap, atendimento_aprovado, nota_qualidade
    )
    select $1::uuid, 'ia', id, $2::numeric,
      true, true, true, true,
      ($3::text in ('atendido', 'nao_se_aplica')),
      true, true,
      $2::numeric >= 7, $2::numeric
    from prompts_ia_avaliadora where ativo
    returning id
  `, [atendimentoId, input.notaIa, input.estadoIa]);
  await queryDatabase(`
    insert into avaliacao_criterios (
      avaliacao_id, criterio_id, criterio_chave, criterio_nome,
      criterio_critico, criterio_condicional, criterio_ordem, estado,
      valor_criterio
    )
    select $1, id, chave, nome, critico, condicional, ordem, $2, valor
    from criterios
    where chave = 'validou_email_por_extenso'
  `, [ia.rows[0]!.id, input.estadoIa]);

  if (input.notaCurador !== undefined && input.estadoCurador) {
    const curador = await queryDatabase<{ id: string }>(`
      insert into avaliacoes_curador (
        atendimento_id, avaliacao_ia_id, autor_usuario_id, autor_usuario_nome,
        nota, nota_avaliacao_ia
      )
      select $1, $2, id, nome, $3, 8
      from usuarios where papel = 'curador' limit 1
      returning id
    `, [atendimentoId, ia.rows[0]!.id, input.notaCurador]);
    await queryDatabase(`
      insert into avaliacao_curador_criterios (
        avaliacao_curador_id, criterio_id, criterio_chave, criterio_nome,
        criterio_critico, criterio_condicional, criterio_ordem, estado,
        valor_criterio
      )
      select $1, id, chave, nome, critico, condicional, ordem, $2, valor
      from criterios
      where chave = 'validou_email_por_extenso'
    `, [curador.rows[0]!.id, input.estadoCurador]);
  }
}

test.describe.serial('Dashboard da Gestao', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Livia Dashboard', 'agent-dashboard')
      on conflict (elevenlabs_agent_id) do nothing
    `);
    // Isolate KPIs from other e2e files that park Atendimentos inside this window.
    // Avaliações are immutable, so move rows out instead of deleting them.
    await queryDatabase(`
      update atendimentos
      set concluido_em = '2024-06-01T00:00:00Z'
      where concluido_em >= '2025-01-01T00:00:00Z'
        and concluido_em < '2025-02-02T00:00:00Z'
    `);
    await createDashboardAtendimento({
      conversationId: 'conv-dashboard-1',
      concluidoEm: '2025-01-10T12:00:00Z',
      duracao: 120,
      motivo: 'Rede credenciada',
      transferencia: true,
      custo: 2.5,
      notaIa: 8,
      notaCurador: 8,
      estadoIa: 'nao_se_aplica',
      estadoCurador: 'nao_se_aplica'
    });
    await createDashboardAtendimento({
      conversationId: 'conv-dashboard-2',
      concluidoEm: '2025-01-20T12:00:00Z',
      duracao: 60,
      motivo: 'Financeiro / Boletos',
      transferencia: false,
      custo: 1.5,
      notaIa: 6,
      notaCurador: 5,
      estadoIa: 'atendido',
      estadoCurador: 'nao_atendido'
    });
    await createDashboardAtendimento({
      conversationId: 'conv-dashboard-fora-periodo',
      concluidoEm: '2025-02-01T12:00:00Z',
      duracao: 900,
      motivo: 'Fora do periodo',
      transferencia: true,
      custo: 99,
      notaIa: 1,
      estadoIa: 'nao_atendido'
    });
  });

  test('agrega todos os indicadores pelo mesmo periodo', async ({ request }) => {
    const gestao = await loginApi(request, 'gestao');
    const response = await request.get(
      `${apiUrl}/dashboards/gestao?inicio=2025-01-01&fim=2025-01-31`,
      { headers: { authorization: `Bearer ${gestao.token}` } }
    );

    expect(response.status()).toBe(200);
    const dashboard = await response.json();
    expect(dashboard.periodo).toEqual({ inicio: '2025-01-01', fim: '2025-01-31' });
    expect(dashboard.kpis).toEqual({
      volume: 2,
      tmaSegundos: 90,
      notaMediaIa: 7,
      notaMediaCurador: 6.5,
      transferencias: 1,
      resolvidosSemTransferencia: 1,
      custoTotal: 4,
      custoMedio: 2
    });
    expect(dashboard.motivosContato).toEqual([
      { motivo: 'Financeiro / Boletos', total: 1 },
      { motivo: 'Rede credenciada', total: 1 }
    ]);
    expect(dashboard.criterios).toContainEqual(
      expect.objectContaining({
        chave: 'validou_email_por_extenso',
        atendidos: 1,
        avaliados: 1,
        percentualAcerto: 100
      })
    );
    expect(dashboard.concordancia.nota).toEqual({
      concordantes: 1,
      total: 2,
      percentual: 50
    });
    expect(dashboard.concordancia.criterios).toEqual({
      concordantes: 1,
      total: 2,
      percentual: 50
    });
    expect(dashboard.concordancia.porCriterio).toContainEqual(
      expect.objectContaining({
        chave: 'validou_email_por_extenso',
        concordantes: 1,
        total: 2,
        percentual: 50
      })
    );
    expect(dashboard.pioresAtendimentos[0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv-dashboard-2',
        notaIa: 6,
        notaCurador: 5
      })
    );
  });

  test('restringe o dashboard a Admin e Gestao e nao oferece mutacao', async ({
    request
  }) => {
    const admin = await loginApi(request, 'admin');
    const curador = await loginApi(request, 'curador');
    const gestao = await loginApi(request, 'gestao');
    const url = `${apiUrl}/dashboards/gestao?inicio=2025-01-01&fim=2025-01-31`;

    expect(
      (await request.get(url, {
        headers: { authorization: `Bearer ${admin.token}` }
      })).status()
    ).toBe(200);
    expect(
      (await request.get(url, {
        headers: { authorization: `Bearer ${curador.token}` }
      })).status()
    ).toBe(403);
    expect(
      (await request.post(url, {
        headers: { authorization: `Bearer ${gestao.token}` }
      })).status()
    ).toBe(403);
  });

  test('exibe a leitura gerencial filtravel sem controles de escrita', async ({
    page
  }) => {
    await loginPage(page, 'gestao');
    await page.goto('/gestao/dashboard?inicio=2025-01-01&fim=2025-01-31');

    await expect(page.getByRole('heading', { name: 'Pulso da operação' })).toBeVisible();
    await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Financeiro / Boletos').first()).toBeVisible();
    await expect(page.getByText('Concordância')).toBeVisible();
    await expect(page.getByLabel('Gráfico de Motivos de Contato')).toBeVisible();
    await expect(page.getByLabel('Gráfico de acerto por Critério')).toBeVisible();
    await expect(page.getByLabel('Gráfico de Concordância por Critério')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Piores Atendimentos' })).toBeVisible();
    await expect(page.locator('.piores-panel canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /salvar|editar|excluir/i })).toHaveCount(0);
  });
});
