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
    checklist: Record<string, string>;
    falhas_identificadas: string[];
    resumo_atendimento: string;
  }
) {
  return queryDatabase<{ avaliacao_id: string; nota: string }>(`
    select * from persistir_avaliacao_ia(
      $1,
      (select id from prompts_ia_avaliadora where ativo),
      $2::jsonb,
      $3::jsonb,
      $4
    )
  `, [
    atendimentoId,
    JSON.stringify(fixture.checklist),
    JSON.stringify(fixture.falhas_identificadas),
    fixture.resumo_atendimento
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

  test('reivindica pendencias distintas e entrega o contrato canonico da Regua', async () => {
    const firstAtendimentoId = await createAtendimento('conv-claim-primeiro');
    const secondAtendimentoId = await createAtendimento('conv-claim-segundo');
    const claimedIds = [firstAtendimentoId, secondAtendimentoId];

    try {
      const first = await queryDatabase<{
        atendimento_id: string;
        checklist_schema: Record<string, { enum: string[] }>;
        criterio_chaves: string[];
      }>('select * from reivindicar_avaliacoes_ia(1)');
      const second = await queryDatabase<{ atendimento_id: string }>(
        'select * from reivindicar_avaliacoes_ia(1)'
      );

      expect(first.rows[0]?.atendimento_id).not.toBe(second.rows[0]?.atendimento_id);
      expect(claimedIds).toContain(first.rows[0]?.atendimento_id);
      expect(claimedIds).toContain(second.rows[0]?.atendimento_id);
      expect(first.rows[0]?.criterio_chaves).toContain('solicitou_cpf');
      expect(first.rows[0]?.checklist_schema.validou_email_por_extenso?.enum).toContain(
        'nao_se_aplica'
      );
      expect(first.rows[0]?.checklist_schema.solicitou_cpf?.enum).not.toContain(
        'nao_se_aplica'
      );
    } finally {
      await queryDatabase(
        'delete from atendimentos where id = any($1::uuid[])',
        [claimedIds]
      );
    }
  });

  test('persiste checklist e nota recalculada sem estado parcial', async () => {
    const atendimentoId = await createAtendimento('conv-avaliacao-aprovada');
    const result = await persistirAvaliacao(atendimentoId, aprovada);

    expect(Number(result.rows[0]?.nota)).toBe(9.5);
    const checks = await queryDatabase<{ count: string }>(
      `select count(*) from avaliacao_criterios ac
       join avaliacoes a on a.id = ac.avaliacao_id
       where a.atendimento_id = $1`,
      [atendimentoId]
    );
    expect(checks.rows[0]?.count).toBe('7');

    const invalidId = await createAtendimento('conv-avaliacao-invalida');
    await expect(
      persistirAvaliacao(invalidId, {
        ...aprovada,
        checklist: { ...aprovada.checklist, criterio_inexistente: 'atendido' }
      })
    ).rejects.toThrow();
    const invalidState = await queryDatabase<{ count: string }>(
      'select count(*) from avaliacoes where atendimento_id = $1',
      [invalidId]
    );
    expect(invalidState.rows[0]?.count).toBe('0');
  });

  test('pontua Nao se aplica e preserva o estado no snapshot', async () => {
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
    expect(check.rows[0]?.estado).toBe('nao_se_aplica');
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

  test('HQ consulta o snapshot, deriva Falha Critica e nao oferece escrita', async ({
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
      falhasIdentificadas: falhaCritica.falhas_identificadas,
      resumoAtendimento: falhaCritica.resumo_atendimento,
      promptVersao: 2,
      checklist: expect.arrayContaining([
        expect.objectContaining({
          chave: 'informou_protocolo_email',
          critico: true,
          estado: 'nao_atendido'
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
        checklist: expect.arrayContaining([
          expect.objectContaining({
            chave: 'informou_protocolo_email',
            nome: 'Informação de Protocolo',
            valor: 2.5,
            critico: true,
            estado: 'nao_atendido',
            ordem: 3
          })
        ])
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
    await page.goto(`/atendimentos/${result.rows[0]!.id}`);

    await expect(page.getByRole('heading', { name: 'Avaliação da IA' })).toBeVisible();
    await expect(page.getByText('Reprovado')).toBeVisible();
    await expect(page.getByText('7,5')).toBeVisible();
    await expect(page.getByText('Informação de Protocolo')).toBeVisible();
    await expect(page.getByText('Prompt v2')).toBeVisible();
  });
});
