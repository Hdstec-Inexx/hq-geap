import { expect, test } from '@playwright/test';
import pg from 'pg';
import aprovada from '../fixtures/avaliacoes/avaliacao-aprovada.json' with { type: 'json' };
import { ensureMinioTestAudio } from '../support/audio-fixture.js';

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

async function createAtendimentoComTranscricao(
  conversationId: string,
  transcricao: unknown[]
) {
  const result = await queryDatabase<{ id: string }>(`
    insert into atendimentos (
      agente_voz_id, elevenlabs_conversation_id, status, transcricao,
      audio_url, houve_transferencia, concluido_em, duracao_segundos,
      motivo_contato
    )
    select id, $1, 'concluido'::status_atendimento,
      $2::jsonb,
      'atendimentos/teste.mp3', false, now(), 60, 'Segunda via de boleto'
    from agentes_voz
    where elevenlabs_agent_id = 'agent-livia-test'
    returning id
  `, [conversationId, JSON.stringify(transcricao)]);
  return result.rows[0]!.id;
}

async function persistirAvaliacaoIa(atendimentoId: string) {
  await queryDatabase(`
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
    JSON.stringify(aprovada.checklist),
    JSON.stringify(aprovada.falhas_identificadas),
    aprovada.resumo_atendimento,
    aprovada.atendimento_aprovado,
    aprovada.nota_qualidade
  ]);
}

async function seedComentarios(atendimentoId: string, count: number = 8) {
  await queryDatabase(`
    insert into comentarios (atendimento_id, autor_usuario_id, texto, criado_em)
    select $1, id, 'Comentário de teste para scroll da página ' || gs::text, now()
    from usuarios
    cross join generate_series(1, $2::int) as gs
    where email = 'admin@hq.test'
  `, [atendimentoId, count]);
}

const defaultTranscript = [
  { role: 'agent' as const, message: 'Olá! Sou a Lívia da GEAP.', time_in_call_secs: 0 },
  { role: 'user' as const, message: 'Preciso da segunda via do meu boleto.', time_in_call_secs: 10 },
  { role: 'agent' as const, message: 'Vou consultar o sistema para você agora mesmo.', time_in_call_secs: 25 },
  { role: 'user' as const, message: 'Muito obrigado pela agilidade.', time_in_call_secs: 45 },
  ...Array.from({ length: 40 }, (_, i) => ({
    role: (i % 2 === 0 ? 'agent' : 'user') as 'agent' | 'user',
    message: `Turno adicional ${i + 5} de detalhamento da conversa gerando conteúdo suficiente na página.`,
    time_in_call_secs: 50 + i
  }))
];

test.describe.serial('Miniplayer persistente com animações', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Lívia', 'agent-livia-test')
      on conflict (elevenlabs_agent_id) do nothing
    `);
    await ensureMinioTestAudio(['atendimentos/teste.mp3'], 60);
  });

  test('Desktop: miniplayer ativa ao rolar, revela com hover e esconde ao sair com transição', async ({
    page
  }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-desktop-hover',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);
    await seedComentarios(atendimentoId, 8);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // No início da página, o miniplayer não deve existir ou não estar ativo
    await expect(page.getByTestId('audio-player')).toBeVisible();
    await expect(page.getByTestId('miniplayer')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();

    // Inicia a reprodução no player principal
    const mainPlayBtn = page.getByRole('button', { name: 'Reproduzir áudio' });
    await mainPlayBtn.click();
    await expect(page.getByRole('button', { name: 'Pausar áudio' })).toBeVisible();

    // Rola a página para baixo além do player principal até os comentários
    await page.locator('.comentarios-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);

    // Agora o miniplayer está montado
    const miniplayerContainer = page.getByTestId('miniplayer-container');
    await expect(miniplayerContainer).toBeAttached();

    // Passar o mouse no topo da tela revela o miniplayer com slide + fade
    await page.mouse.move(300, 5);
    const miniplayer = page.getByTestId('miniplayer');
    await expect(miniplayer).toBeVisible();

    // Pausar pelo miniplayer
    const miniPlayPause = page.getByTestId('miniplayer-play-pause-btn');
    await miniPlayPause.click();
    await expect(miniPlayPause).toHaveAttribute('aria-label', 'Reproduzir áudio');

    // Controles do miniplayer funcionam: avançar 30s
    const miniSkipForward = page.getByTestId('miniplayer-skip-forward');
    await miniSkipForward.click();
    await expect(page.getByTestId('miniplayer-current-time')).toHaveText(/00:3\d/);

    // Retornar 30s pelo miniplayer
    const miniSkipBack = page.getByTestId('miniplayer-skip-back');
    await miniSkipBack.click();
    await expect(page.getByTestId('miniplayer-current-time')).toHaveText('00:00');

    // Ao retirar o mouse do topo para o centro da página, o miniplayer esconde
    await page.mouse.move(500, 600);
    await expect(miniplayerContainer).not.toHaveClass(/is-hovered/);
  });

  test('Touch: miniplayer compacto aparece diretamente ao rolar e some ao voltar ao topo', async ({
    browser
  }) => {
    // Cria contexto emulando dispositivo touch / mobile
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 }
    });
    const page = await context.newPage();

    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-touch-behavior',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);
    await seedComentarios(atendimentoId, 8);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // No topo, miniplayer não aparece
    await expect(page.getByTestId('audio-player')).toBeVisible();
    await expect(page.getByTestId('miniplayer')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();

    // Rola para baixo além do player principal até a seção de comentários
    await page.locator('.comentarios-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);

    // Em touch, o miniplayer aparece compacto imediatamente (sem hover)
    const miniplayer = page.getByTestId('miniplayer');
    await expect(miniplayer).toBeVisible();
    await expect(page.getByTestId('miniplayer-play-pause-btn')).toBeVisible();

    // Rola de volta ao topo onde o player principal volta a ficar visível
    await page.getByRole('heading', { name: 'Atendimento' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // O miniplayer some quando o player volta à vista
    await expect(page.getByTestId('miniplayer')).toHaveCount(0);

    await context.close();
  });

  test('Miniplayer desaparece sozinho ao fim do áudio', async ({ page }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-ended',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);
    await seedComentarios(atendimentoId, 8);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();

    // Rola além do player principal
    await page.locator('.comentarios-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);

    // Hover no topo para abrir o miniplayer
    await page.mouse.move(300, 5);
    const miniplayer = page.getByTestId('miniplayer');
    await expect(miniplayer).toBeVisible();

    // Simula término do áudio disparando evento ended no elemento de áudio
    await page.evaluate(() => {
      const audio = document.querySelector('audio');
      if (audio) {
        audio.dispatchEvent(new Event('ended'));
      }
    });

    // O miniplayer desaparece automaticamente ao fim do áudio
    await expect(page.getByTestId('miniplayer')).toHaveCount(0);
  });

  test('Navegar para fora da página de detalhe interrompe a reprodução', async ({ page }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-navigation-stop',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // Inicia reprodução
    const playBtn = page.getByRole('button', { name: 'Reproduzir áudio' });
    await playBtn.click();
    await expect(page.getByRole('button', { name: 'Pausar áudio' })).toBeVisible();

    // Navega para fora da página de detalhe clicando em "Voltar à lista"
    await page.getByRole('link', { name: 'Voltar à lista' }).click();
    await expect(page.getByRole('heading', { name: 'Atendimentos' })).toBeVisible();

    // Verifica que nenhum áudio continua tocando na aplicação
    const isAnyAudioPlaying = await page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll('audio'));
      return audios.some((a) => !a.paused);
    });
    expect(isAnyAudioPlaying).toBe(false);
  });

  test('Animações do miniplayer respeitam prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();

    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-reduced-motion',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);
    await seedComentarios(atendimentoId, 8);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();
    await page.locator('.comentarios-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);

    await page.mouse.move(300, 5);
    const miniplayer = page.getByTestId('miniplayer');
    await expect(miniplayer).toBeVisible();

    // Verifica que a transição é desativada (transition-duration = 0s ou transition = none)
    const transition = await miniplayer.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.transition;
    });
    expect(transition).toMatch(/none|0s/);

    await context.close();
  });

  test('Miniplayer funciona também na revisão da Fila de Curadoria', async ({ page }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-curadoria-review',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);
    await seedComentarios(atendimentoId, 8);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/curadoria/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    await expect(page.getByTestId('miniplayer')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Comentários' })).toBeVisible();

    // Inicia reprodução
    const playBtn = page.getByRole('button', { name: 'Reproduzir áudio' });
    await playBtn.click();
    await expect(page.getByRole('button', { name: 'Pausar áudio' })).toBeVisible();

    // Rola para baixo até o formulário do Curador / Comentários
    await page.locator('.comentarios-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);

    // Revela miniplayer por hover no topo
    await page.mouse.move(300, 5);
    const miniplayer = page.getByTestId('miniplayer');
    await expect(miniplayer).toBeVisible();
    await expect(page.getByTestId('miniplayer-current-time')).toBeVisible();

    // Pausa e avança pelo miniplayer
    await page.getByTestId('miniplayer-play-pause-btn').click();
    await page.getByTestId('miniplayer-skip-forward').click();
    await expect(page.getByTestId('miniplayer-current-time')).toHaveText('00:30');
  });

  test('Controle de velocidade de reprodução: ciclar, seletor direto, sincronização e persistência no localStorage', async ({
    page
  }) => {
    const atendimentoId = await createAtendimentoComTranscricao(
      'conv-miniplayer-playback-rate',
      defaultTranscript
    );
    await persistirAvaliacaoIa(atendimentoId);
    await seedComentarios(atendimentoId, 8);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/atendimentos/${atendimentoId}`);

    // No player principal, verifica velocidade inicial 1x
    const speedBtn = page.getByTestId('audio-speed-btn');
    const speedSelect = page.getByTestId('audio-speed-select');
    await expect(speedBtn).toHaveText('1x');
    await expect(speedSelect).toHaveValue('1');

    // Clica no botão rápido para ciclar a velocidade: 1x -> 1.25x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('1.25x');
    await expect(speedSelect).toHaveValue('1.25');

    // Verifica que o elemento audio teve playbackRate atualizado
    const audioRate125 = await page.evaluate(() => document.querySelector('audio')?.playbackRate);
    expect(audioRate125).toBe(1.25);

    // Cicla novamente: 1.25x -> 1.5x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('1.5x');
    await expect(speedSelect).toHaveValue('1.5');

    // Cicla: 1.5x -> 2x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('2x');
    await expect(speedSelect).toHaveValue('2');

    // Cicla: 2x -> 0.5x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('0.5x');
    await expect(speedSelect).toHaveValue('0.5');

    // Cicla: 0.5x -> 1x
    await speedBtn.click();
    await expect(speedBtn).toHaveText('1x');
    await expect(speedSelect).toHaveValue('1');

    // Usa o seletor direto para escolher 1.5x
    await speedSelect.selectOption('1.5');
    await expect(speedBtn).toHaveText('1.5x');
    await expect(speedSelect).toHaveValue('1.5');

    // Rola para exibir o miniplayer
    await page.locator('.comentarios-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(300);

    // Revela miniplayer
    await page.mouse.move(300, 5);
    const miniSpeedBtn = page.getByTestId('miniplayer-speed-btn');
    const miniSpeedSelect = page.getByTestId('miniplayer-speed-select');

    // Miniplayer está sincronizado em 1.5x
    await expect(miniSpeedBtn).toHaveText('1.5x');
    await expect(miniSpeedSelect).toHaveValue('1.5');

    // Altera pelo miniplayer via clique rápido para 2x
    await miniSpeedBtn.click();
    await expect(miniSpeedBtn).toHaveText('2x');
    await expect(miniSpeedSelect).toHaveValue('2');

    // Rola de volta para o topo e verifica que o player principal sincronizou para 2x
    await page.getByRole('heading', { name: 'Atendimento' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(speedBtn).toHaveText('2x');
    await expect(speedSelect).toHaveValue('2');

    // Recarrega a página e valida restauração da preferência do localStorage
    await page.reload();
    await expect(page.getByTestId('audio-speed-btn')).toHaveText('2x');
    await expect(page.getByTestId('audio-speed-select')).toHaveValue('2');
  });
});
