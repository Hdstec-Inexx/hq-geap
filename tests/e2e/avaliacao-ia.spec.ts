import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';
import aprovada from '../fixtures/avaliacoes/avaliacao-aprovada.json' with { type: 'json' };
import falhaCritica from '../fixtures/avaliacoes/falha-critica.json' with { type: 'json' };
import naoAplicavel from '../fixtures/avaliacoes/criterio-nao-aplicavel.json' with { type: 'json' };
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

async function login(request: APIRequestContext) {
  const user = authUsers.find((candidate) => candidate.role === 'admin')!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  return (await response.json()) as { token: string };
}

async function createAtendimento(conversationId: string) {
  const result = await queryDatabase<{ id: string }>(`
    insert into atendimentos (
      agente_voz_id, elevenlabs_conversation_id, status, transcricao,
      houve_transferencia, concluido_em
    )
    select id, $1, 'concluido', '[]'::jsonb, false, now()
    from agentes_voz
    where elevenlabs_agent_id = 'agent-livia-test'
    returning id
  `, [conversationId]);
  return result.rows[0]!.id;
}

async function persistirAvaliacao(
  atendimentoId: string,
  fixture: {
    checklist: Record<string, boolean>;
    falhas_identificadas: string[];
    resumo_atendimento: string;
    atendimento_aprovado: boolean;
    nota_qualidade: number;
  }
) {
  return queryDatabase<{ avaliacao_id: string; nota: string }>(`
    select * from persistir_avaliacao_ia(
      $1,
      (select id from prompts_ia_avaliadora where ativo),
      $2::jsonb,
      $3::jsonb,
      $4,
      $5,
      $6
    )
  `, [
    atendimentoId,
    JSON.stringify(fixture.checklist),
    JSON.stringify(fixture.falhas_identificadas),
    fixture.resumo_atendimento,
    fixture.atendimento_aprovado,
    fixture.nota_qualidade
  ]);
}

test.describe.serial('persistencia e exibicao da Avaliacao da IA', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia', 'agent-livia-test')
      on conflict (elevenlabs_agent_id) do nothing
    `);
  });

  test('reivindica pendencias distintas e entrega o contrato booleano da LLM', async () => {
    const firstAtendimentoId = await createAtendimento('conv-claim-primeiro');
    const secondAtendimentoId = await createAtendimento('conv-claim-segundo');
    const claimedIds = [firstAtendimentoId, secondAtendimentoId];

    try {
      // Isolate from leftover pending Atendimentos left by other e2e files.
      await queryDatabase(`
        delete from atendimentos a
        where a.status = 'concluido'
          and a.id <> all($1::uuid[])
          and not exists (
            select 1 from avaliacoes av
            where av.atendimento_id = a.id and av.autor = 'ia'
          )
      `, [claimedIds]);
      await queryDatabase('delete from avaliacoes_ia_execucoes');

      const first = await queryDatabase<{
        atendimento_id: string;
        checklist_schema: Record<string, { type: string }>;
        criterio_chaves: string[];
      }>('select * from reivindicar_avaliacoes_ia(1)');
      const second = await queryDatabase<{ atendimento_id: string }>(
        'select * from reivindicar_avaliacoes_ia(1)'
      );

      expect(first.rows[0]?.atendimento_id).not.toBe(second.rows[0]?.atendimento_id);
      expect(claimedIds).toContain(first.rows[0]?.atendimento_id);
      expect(claimedIds).toContain(second.rows[0]?.atendimento_id);
      expect(first.rows[0]?.criterio_chaves).toContain('solicitou_cpf');
      expect(first.rows[0]?.criterio_chaves).toContain('uso_correto_ferramentas');
      expect(first.rows[0]?.checklist_schema.validou_email_por_extenso?.type).toBe(
        'boolean'
      );
      expect(first.rows[0]?.checklist_schema.solicitou_cpf?.type).toBe('boolean');
      expect(first.rows[0]?.checklist_schema.uso_correto_ferramentas?.type).toBe(
        'boolean'
      );
    } finally {
      await queryDatabase(
        'delete from atendimentos where id = any($1::uuid[])',
        [claimedIds]
      );
    }
  });

  test('persiste checklist tipado, claims da LLM e nota canonica da Regua', async () => {
    const atendimentoId = await createAtendimento('conv-avaliacao-aprovada');
    const result = await persistirAvaliacao(atendimentoId, aprovada);

    expect(Number(result.rows[0]?.nota)).toBe(9.5);
    const typed = await queryDatabase<{
      saudacao_e_intencao: boolean;
      sem_diminutivos: boolean;
      atendimento_aprovado: boolean;
      nota_qualidade: string;
    }>(`
      select
        saudacao_e_intencao,
        sem_diminutivos,
        atendimento_aprovado,
        nota_qualidade
      from avaliacoes
      where atendimento_id = $1 and autor = 'ia'
    `, [atendimentoId]);
    expect(typed.rows[0]).toMatchObject({
      saudacao_e_intencao: true,
      sem_diminutivos: false,
      atendimento_aprovado: true
    });
    expect(Number(typed.rows[0]?.nota_qualidade)).toBe(9.5);

    const checks = await queryDatabase<{ count: string }>(
      `select count(*) from avaliacao_criterios ac
       join avaliacoes a on a.id = ac.avaliacao_id
       where a.atendimento_id = $1`,
      [atendimentoId]
    );
    expect(checks.rows[0]?.count).toBe('8');

    const invalidId = await createAtendimento('conv-avaliacao-invalida');
    await expect(
      persistirAvaliacao(invalidId, {
        ...aprovada,
        checklist: { ...aprovada.checklist, criterio_inexistente: true }
      })
    ).rejects.toThrow();
    const invalidState = await queryDatabase<{ count: string }>(
      'select count(*) from avaliacoes where atendimento_id = $1',
      [invalidId]
    );
    expect(invalidState.rows[0]?.count).toBe('0');
  });

  test('email nao aplicavel marcado true pontua na Regua e mapeia para atendido', async () => {
    const atendimentoId = await createAtendimento('conv-avaliacao-na');
    const result = await persistirAvaliacao(atendimentoId, naoAplicavel);
    expect(Number(result.rows[0]?.nota)).toBe(10);

    const check = await queryDatabase<{ estado: string }>(`
      select ac.estado
      from avaliacao_criterios ac
      join avaliacoes a on a.id = ac.avaliacao_id
      join criterios c on c.id = ac.criterio_id
      where a.atendimento_id = $1 and c.chave = 'validou_email_por_extenso'
    `, [atendimentoId]);
    expect(check.rows[0]?.estado).toBe('atendido');
  });

  test('reprocessamento nao cria outra Avaliacao da IA', async () => {
    const atendimentoId = await createAtendimento('conv-avaliacao-idempotente');
    const first = await persistirAvaliacao(atendimentoId, aprovada);
    const replay = await persistirAvaliacao(atendimentoId, falhaCritica);
    expect(replay.rows[0]?.avaliacao_id).toBe(first.rows[0]?.avaliacao_id);

    const count = await queryDatabase<{ count: string }>(
      `select count(*) from avaliacoes
       where atendimento_id = $1 and autor = 'ia'`,
      [atendimentoId]
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  test('HQ consulta o snapshot tipado, deriva Falha Critica e nao oferece escrita', async ({
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-avaliacao-critica');
    await persistirAvaliacao(atendimentoId, falhaCritica);
    const session = await login(request);
    const headers = { authorization: `Bearer ${session.token}` };

    const response = await request.get(
      `${apiUrl}/atendimentos/${atendimentoId}/avaliacao-ia`,
      { headers }
    );
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      aprovacao: 'reprovado',
      nota: 7.5,
      notaQualidade: 7.5,
      atendimentoAprovado: false,
      falhasIdentificadas: falhaCritica.falhas_identificadas,
      resumoAtendimento: falhaCritica.resumo_atendimento,
      promptVersao: 4,
      checklist: {
        informou_protocolo_email: false,
        resolveu_solicitacao: true,
        uso_correto_ferramentas: true
      },
      criterios: expect.arrayContaining([
        expect.objectContaining({
          chave: 'informou_protocolo_email',
          nome: 'Informação de Protocolo',
          atendido: false,
          critico: true,
          valor: 2.5
        }),
        expect.objectContaining({
          chave: 'uso_correto_ferramentas',
          nome: 'Uso Correto de Ferramentas',
          atendido: true,
          valor: 0
        })
      ])
    });

    await queryDatabase(`
      update criterios
      set nome = 'Nome atual alterado', valor = 0.25, critico = false, ordem = 99
      where chave = 'informou_protocolo_email'
    `);
    try {
      const snapshotResponse = await request.get(
        `${apiUrl}/atendimentos/${atendimentoId}/avaliacao-ia`,
        { headers }
      );
      await expect(snapshotResponse.json()).resolves.toMatchObject({
        aprovacao: 'reprovado',
        checklist: {
          informou_protocolo_email: false
        }
      });
    } finally {
      await queryDatabase(`
        update criterios
        set nome = 'Informação de Protocolo', valor = 2.5, critico = true, ordem = 3
        where chave = 'informou_protocolo_email'
      `);
    }

    const writeResponse = await request.post(
      `${apiUrl}/atendimentos/${atendimentoId}/avaliacao-ia`,
      { headers, data: falhaCritica }
    );
    expect(writeResponse.status()).toBe(404);
  });

  test('detalhe do Atendimento exibe a Avaliacao da IA gravada', async ({ page }) => {
    const result = await queryDatabase<{ id: string }>(
      `select id from atendimentos
       where elevenlabs_conversation_id = 'conv-avaliacao-critica'`
    );
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@hq.test');
    await page.getByLabel('Senha').fill('senha-admin');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${result.rows[0]!.id}`);

    await expect(page.getByRole('heading', { name: 'Avaliação da IA' })).toBeVisible();
    await expect(page.getByText('Reprovado', { exact: true })).toBeVisible();
    await expect(page.getByText('7,5').first()).toBeVisible();
    await expect(page.getByText(/Claims da LLM/i)).toBeVisible();
    await expect(page.getByText(/Aprovação claim: não/i)).toBeVisible();
    await expect(page.getByText('Informação de Protocolo')).toBeVisible();
    await expect(page.getByText('Prompt v4')).toBeVisible();
    await expect(page.getByText('Uso Correto de Ferramentas')).toBeVisible();
  });

  test('gate: ferramentas false forca resolucao false e perde 3 pontos', async () => {
    const atendimentoId = await createAtendimento('conv-avaliacao-gate-ferramentas');
    const result = await persistirAvaliacao(atendimentoId, {
      ...aprovada,
      checklist: {
        ...aprovada.checklist,
        uso_correto_ferramentas: false,
        resolveu_solicitacao: true
      },
      atendimento_aprovado: false,
      nota_qualidade: 6.5
    });

    expect(Number(result.rows[0]?.nota)).toBe(6.5);
    const typed = await queryDatabase<{
      uso_correto_ferramentas: boolean;
      resolveu_solicitacao: boolean;
    }>(`
      select uso_correto_ferramentas, resolveu_solicitacao
      from avaliacoes
      where atendimento_id = $1 and autor = 'ia'
    `, [atendimentoId]);
    expect(typed.rows[0]).toMatchObject({
      uso_correto_ferramentas: false,
      resolveu_solicitacao: false
    });
  });
});
