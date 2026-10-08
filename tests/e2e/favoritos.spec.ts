import { expect, test } from '@playwright/test';
import pg from 'pg';
import { loginApi, loginPage } from '../support/e2e-auth.js';

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

test.describe.serial('Favoritar e desfavoritar no detalhe e no Monitoramento ao Vivo', () => {
  let agenteVozId: string;
  let atendimentoId: string;
  let livePersistedAtendimentoId: string;
  const convDetailId = 'conv-favorito-detail-e2e';
  const convLivePersistedId = 'conv-favorito-live-persisted-e2e';
  const convLiveNotPersistedId = 'conv-favorito-live-not-persisted-e2e';

  test.beforeAll(async () => {
    const agente = await queryDatabase<{ id: string }>(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Favoritos', 'agent-livia-favoritos')
      on conflict (elevenlabs_agent_id) do update set nome = 'Lívia Favoritos'
      returning id
    `);
    agenteVozId = agente.rows[0]!.id;

    const atendimento = await queryDatabase<{ id: string }>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em, concluido_em,
        duracao_segundos, transcricao, motivo_contato, houve_transferencia
      ) values (
        $1, $2, 'concluido', now() - interval '10 minutes', now(),
        300, '[{"role":"agent","message":"Olá","time_in_call_secs":0}]'::jsonb,
        'Dúvidas sobre plano', false
      )
      on conflict (elevenlabs_conversation_id) do update set status = 'concluido'
      returning id
    `, [agenteVozId, convDetailId]);
    atendimentoId = atendimento.rows[0]!.id;

    const liveAtendimento = await queryDatabase<{ id: string }>(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, iniciado_em,
        transcricao, motivo_contato, houve_transferencia
      ) values (
        $1, $2, 'em_andamento', now(),
        '[{"role":"agent","message":"Bom dia","time_in_call_secs":0}]'::jsonb,
        'Informações', false
      )
      on conflict (elevenlabs_conversation_id) do update set status = 'em_andamento'
      returning id
    `, [agenteVozId, convLivePersistedId]);
    livePersistedAtendimentoId = liveAtendimento.rows[0]!.id;
  });

  test('Curador pode marcar e desmarcar favorito no detalhe do Atendimento', async ({
    page,
    request
  }) => {
    const session = await loginApi(request, 'curador');
    const curadorId = session.user.id;

    // Limpa favoritos prévios do teste
    await queryDatabase(
      'delete from favoritos where atendimento_id = $1 and perfil_id = $2',
      [atendimentoId, curadorId]
    );

    await loginPage(page, 'curador');
    await page.goto(`/atendimentos/${atendimentoId}`);

    const favButton = page.locator('[data-testid="favorito-button"]');
    await expect(favButton).toBeVisible();
    await expect(favButton).toHaveAttribute('aria-pressed', 'false');

    // 1. Marca como favorito
    await favButton.click();
    await expect(favButton).toHaveAttribute('aria-pressed', 'true');

    const dbCheck1 = await queryDatabase<{ count: string }>(
      'select count(*) from favoritos where atendimento_id = $1 and perfil_id = $2',
      [atendimentoId, curadorId]
    );
    expect(dbCheck1.rows[0]?.count).toBe('1');

    // 2. Desmarca favorito
    await favButton.click();
    await expect(favButton).toHaveAttribute('aria-pressed', 'false');

    const dbCheck2 = await queryDatabase<{ count: string }>(
      'select count(*) from favoritos where atendimento_id = $1 and perfil_id = $2',
      [atendimentoId, curadorId]
    );
    expect(dbCheck2.rows[0]?.count).toBe('0');

    for (const role of ['gestao', 'admin'] as const) {
      const session = await loginApi(request, role);
      const forbidden = await request.post(`${apiUrl}/atendimentos/${atendimentoId}/favorito`, {
        headers: { authorization: `Bearer ${session.token}` }
      });
      expect(forbidden.status()).toBe(403);
    }
  });

  test('Gestão e Admin veem indicação somente leitura no detalhe sem poder marcar', async ({
    page
  }) => {
    await loginPage(page, 'gestao');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // Gestão não tem o botão interativo
    await expect(page.locator('[data-testid="favorito-button"]')).toHaveCount(0);
    // Mas tem a indicação somente leitura
    await expect(page.locator('[data-testid="favoritos-readonly"]')).toBeVisible();

    await loginPage(page, 'admin');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // Admin também tem somente leitura
    await expect(page.locator('[data-testid="favorito-button"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="favoritos-readonly"]')).toBeVisible();
  });

  test('No Monitoramento ao Vivo o botão fica desabilitado se não persistido e habilitado quando persistido', async ({
    page
  }) => {
    await loginPage(page, 'curador');

    // 1. Chamada não persistida no HQ -> botão visível porém desabilitado
    await page.goto(`/monitoramento/${convLiveNotPersistedId}`);
    const liveButtonDisabled = page.locator('[data-testid="favorito-live-button"]');
    await expect(liveButtonDisabled).toBeVisible();
    await expect(liveButtonDisabled).toBeDisabled();
    await expect(liveButtonDisabled).toHaveAttribute(
      'title',
      'O Atendimento ainda não foi persistido no HQ'
    );

    // 2. Chamada persistida no HQ -> botão habilitado
    await page.goto(`/monitoramento/${convLivePersistedId}`);
    const liveButtonEnabled = page.locator('[data-testid="favorito-live-button"]');
    await expect(liveButtonEnabled).toBeVisible();
    await expect(liveButtonEnabled).toBeEnabled();

    // Curador alterna favorito no Monitoramento ao Vivo
    await liveButtonEnabled.click();
    await expect(liveButtonEnabled).toHaveAttribute('aria-pressed', 'true');
    const liveFavorito = await queryDatabase<{ count: string }>(
      'select count(*) from favoritos where atendimento_id = $1',
      [livePersistedAtendimentoId]
    );
    expect(liveFavorito.rows[0]?.count).toBe('1');

    await liveButtonEnabled.click();
    await expect(liveButtonEnabled).toHaveAttribute('aria-pressed', 'false');
    const liveDesfavorito = await queryDatabase<{ count: string }>(
      'select count(*) from favoritos where atendimento_id = $1',
      [livePersistedAtendimentoId]
    );
    expect(liveDesfavorito.rows[0]?.count).toBe('0');
  });

  test('lista Favoritos na casca, filtra, remove para Curador e consolida para Gestão', async ({
    page,
    request
  }) => {
    const session = await loginApi(request, 'curador');
    await queryDatabase('insert into favoritos (perfil_id, atendimento_id) values ($1, $2) on conflict do nothing', [session.user.id, atendimentoId]);

    await loginPage(page, 'curador');
    await page.goto('/favoritos');
    await expect(page.getByRole('link', { name: 'Favoritos' })).toBeVisible();
    await expect(page.getByText(convDetailId)).toBeVisible();
    await page.getByLabel('Agente de Voz').selectOption(agenteVozId);
    await page.getByPlaceholder('Buscar por ID...').fill(convDetailId);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/conversationId=conv-favorito-detail-e2e/);
    await page.getByRole('button', { name: `Desfazer favorito de ${convDetailId}` }).click();
    await expect(page.getByText(convDetailId)).toHaveCount(0);

    await queryDatabase('insert into favoritos (perfil_id, atendimento_id) values ($1, $2) on conflict do nothing', [session.user.id, atendimentoId]);
    await loginPage(page, 'gestao');
    await page.goto('/favoritos');
    await page.getByLabel('Perfil de Curador').selectOption(session.user.id);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/perfilId=/);
    await expect(page.getByText(convDetailId)).toBeVisible();
    await expect(page.getByText(/Favoritado por/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Desfazer favorito/ })).toHaveCount(0);
  });
});
