import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import pg from 'pg';
import { fetchPerfil, loginApi, loginPage } from '../support/e2e-auth.js';

const apiUrl = 'http://127.0.0.1:3000';
const { Client } = pg;

const nearBottomPx = 80;

async function transcriptScrollMetrics(scroll: Locator) {
  return scroll.evaluate(
    (el, threshold) => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      return {
        distance,
        nearBottom: distance <= threshold,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
      };
    },
    nearBottomPx
  );
}

async function stubMonitoramentoLiveWs(page: Page) {
  let route: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/monitoramento\/conversas\//, (ws) => {
    route = ws;
    ws.onMessage((message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message));
      } catch {
        return;
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('type' in parsed) ||
        parsed.type !== 'auth'
      ) {
        return;
      }
      ws.send(JSON.stringify({ type: 'ready' }));
      for (let i = 0; i < 40; i += 1) {
        ws.send(
          JSON.stringify({
            type: 'transcript',
            role: i % 2 === 0 ? 'agent' : 'user',
            message: `Linha inicial ${i}`
          })
        );
      }
    });
  });

  return {
    sendTranscript(role: 'agent' | 'user', message: string) {
      if (!route) {
        throw new Error('WebSocket stub ainda não conectou');
      }
      route.send(JSON.stringify({ type: 'transcript', role, message }));
    }
  };
}

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

test.describe.serial('Monitoramento ao Vivo — conversas abertas na ElevenLabs', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia Live', 'agent-livia-live')
      on conflict (elevenlabs_agent_id) do nothing
    `);
  });

  test('API exige sessão e não cai em lista local quando a chave falta', async ({
    request
  }) => {
    const anonymous = await request.get(`${apiUrl}/monitoramento/conversas`);
    expect(anonymous.status()).toBe(401);

    const session = await loginApi(request, 'curador');
    const perfil = await fetchPerfil(request, session.token);
    expect(perfil.id).toBe(session.user.id);
    expect(perfil.role).toBe('curador');

    const response = await request.get(`${apiUrl}/monitoramento/conversas`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    // Sem ELEVENLABS_API_KEY no webServer de e2e: prova que a lista tenta
    // ElevenLabs (503) e não devolve Atendimentos locais em_andamento.
    expect(response.status()).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringMatching(/ELEVENLABS_API_KEY/i)
    });
  });

  test('UI lista só o retorno ao vivo da API e ignora em_andamento local', async ({
    page
  }) => {
    const staleConversationId = `conv-local-stale-${Date.now()}`;
    await queryDatabase(
      `
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, transcricao,
          audio_url, houve_transferencia, concluido_em, duracao_segundos,
          motivo_contato
        )
        select id, $1, 'em_andamento',
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3', false, null, 42, 'Rede credenciada'
        from agentes_voz
        where elevenlabs_agent_id = 'agent-livia-live'
      `,
      [staleConversationId]
    );

    await loginPage(page, 'curador');

    const listCalls: string[] = [];
    await page.route('**/monitoramento/conversas', async (route) => {
      listCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            conversationId: 'conv_el_live',
            agentId: 'agent-livia-live',
            agenteVozNome: 'Lívia Live',
            status: 'in-progress',
            iniciadoEm: '2020-09-13T12:26:40.000Z'
          },
          {
            conversationId: 'conv_el_initiated',
            agentId: 'agent-livia-live',
            agenteVozNome: 'Lívia Live',
            status: 'initiated',
            iniciadoEm: null
          }
        ])
      });
    });

    await page.goto('/monitoramento');
    await expect(
      page.getByRole('heading', { name: 'Monitoramento ao Vivo' })
    ).toBeVisible();
    await expect(
      page.getByText(/Somente leitura|somente observação/i).first()
    ).toBeVisible();

    await expect(page.getByText('conv_el_live')).toBeVisible();
    await expect(page.getByText('conv_el_initiated')).toBeVisible();
    await expect(page.getByText('Em progresso')).toBeVisible();
    await expect(page.getByText('Iniciada')).toBeVisible();
    await expect(page.getByText(staleConversationId)).toHaveCount(0);
    await expect(page.getByText('done')).toHaveCount(0);
    await expect(page.getByText('failed')).toHaveCount(0);
    await expect(page.getByText('processing')).toHaveCount(0);

    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls.every((url) => url.includes('/monitoramento/conversas'))).toBe(
      true
    );
    expect(listCalls.some((url) => /atendimentos|em_andamento|status=/.test(url))).toBe(
      false
    );

    await page.getByRole('link', { name: 'Observar' }).first().click();
    await expect(page).toHaveURL(/\/monitoramento\/conv_el_live$/);
    await expect(
      page.getByText(/somente observação/i).first()
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Voltar/i })).toBeVisible();
    await expect(page.getByText(/end_call|takeover|transfer/i)).toHaveCount(0);
  });

  test('lista refetch ~10s enquanto a página está montada', async ({ page }) => {
    test.setTimeout(45_000);
    await loginPage(page, 'curador');

    const listCallAt: number[] = [];
    await page.route('**/monitoramento/conversas', async (route) => {
      listCallAt.push(Date.now());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            conversationId: 'conv_el_refresh',
            agentId: 'agent-livia-live',
            agenteVozNome: 'Lívia Live',
            status: 'in-progress',
            iniciadoEm: '2020-09-13T12:26:40.000Z'
          }
        ])
      });
    });

    await page.goto('/monitoramento');
    await expect(
      page.getByRole('heading', { name: 'Monitoramento ao Vivo' })
    ).toBeVisible();
    await expect(page.getByText('conv_el_refresh')).toBeVisible();
    await expect(
      page.getByText(/Somente leitura|somente observação/i).first()
    ).toBeVisible();
    await expect(page.getByText(/end_call|takeover|transfer/i)).toHaveCount(0);

    const afterMount = listCallAt.length;
    expect(afterMount).toBeGreaterThan(0);

    // Initial + ~2 polls at 10s. StrictMode may double the mount fetch.
    await expect
      .poll(() => listCallAt.length, { timeout: 28_000 })
      .toBeGreaterThanOrEqual(afterMount + 2);

    const refreshGaps = listCallAt.slice(afterMount).map((at, index, rest) => {
      const previous = index === 0 ? listCallAt[afterMount - 1]! : rest[index - 1]!;
      return at - previous;
    });
    expect(refreshGaps.length).toBeGreaterThanOrEqual(2);
    const medianGap = [...refreshGaps].sort((a, b) => a - b)[
      Math.floor(refreshGaps.length / 2)
    ]!;
    expect(medianGap).toBeGreaterThanOrEqual(8_000);
    expect(medianGap).toBeLessThanOrEqual(15_000);

    await expect(page.getByText(/end_call|takeover|transfer/i)).toHaveCount(0);
  });

  test('transcrição acompanha novas linhas só perto do fim', async ({ page }) => {
    await loginPage(page, 'curador');
    const stub = await stubMonitoramentoLiveWs(page);

    await page.goto('/monitoramento/conv_scroll_follow');
    await expect(page.getByText('Observando em tempo real.')).toBeVisible();
    await expect(page.getByText('Linha inicial 39')).toBeVisible();
    await expect(
      page.getByText(/somente observação/i).first()
    ).toBeVisible();
    await expect(page.getByText(/end_call|takeover|transfer/i)).toHaveCount(0);

    const scroll = page.getByTestId('monitoramento-transcript-scroll');
    await expect(scroll).toBeVisible();
    await expect
      .poll(async () => {
        const metrics = await transcriptScrollMetrics(scroll);
        return metrics.scrollHeight > metrics.clientHeight;
      })
      .toBe(true);
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).nearBottom)
      .toBe(true);

    stub.sendTranscript('agent', 'Mensagem follow nova');
    await expect(page.getByText('Mensagem follow nova')).toBeVisible();
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).nearBottom)
      .toBe(true);

    await scroll.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).scrollTop)
      .toBe(0);

    stub.sendTranscript('user', 'Mensagem sem follow');
    await expect(page.getByText('Mensagem sem follow')).toBeAttached();
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).scrollTop)
      .toBeLessThan(40);
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).nearBottom)
      .toBe(false);

    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).nearBottom)
      .toBe(true);

    stub.sendTranscript('agent', 'Mensagem follow de novo');
    await expect(page.getByText('Mensagem follow de novo')).toBeVisible();
    await expect
      .poll(async () => (await transcriptScrollMetrics(scroll)).nearBottom)
      .toBe(true);

    await expect(page.getByText(/end_call|takeover|transfer/i)).toHaveCount(0);
  });
});
