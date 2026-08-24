import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';
import aprovada from '../fixtures/avaliacoes/avaliacao-aprovada.json' with { type: 'json' };
import { authUsers } from '../support/auth-fixtures.js';
import {
  firstTurnFitsWithoutEmptyBox,
  longTranscript,
  shortTranscript,
  transcriptOverflows,
  transcriptScroll
} from '../support/transcript-scroll.js';

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

async function login(
  request: APIRequestContext,
  role: 'admin' | 'gestao' | 'curador'
) {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: user.email, password: user.password }
  });
  return (await response.json()) as { token: string };
}

async function createAtendimento(
  conversationId: string,
  status: 'em_andamento' | 'concluido' = 'concluido',
  transcricao: unknown[] = shortTranscript
) {
  const result = await queryDatabase<{ id: string }>(`
    insert into atendimentos (
      agente_voz_id, elevenlabs_conversation_id, status, transcricao,
      audio_url, houve_transferencia, concluido_em, duracao_segundos,
      motivo_contato
    )
    select id, $1, $2::status_atendimento,
      $3::jsonb,
      'atendimentos/teste.mp3', false,
      case when $2::text = 'concluido' then now() else null end,
      42, 'Rede credenciada'
    from agentes_voz
    where elevenlabs_agent_id = 'agent-livia-curadoria'
    returning id
  `, [conversationId, status, JSON.stringify(transcricao)]);
  return result.rows[0]!.id;
}

async function esvaziarFila() {
  await queryDatabase(`
    insert into avaliacoes_curador (
      atendimento_id, avaliacao_ia_id, autor_usuario_id, autor_usuario_nome,
      nota, falhas_identificadas, nota_avaliacao_ia
    )
    select
      pendente.id,
      ia.id,
      u.id,
      u.nome,
      8,
      '[]'::jsonb,
      8
    from fila_curadoria pendente
    join avaliacoes ia on ia.atendimento_id = pendente.id and ia.autor = 'ia'
    join usuarios u on u.email = 'curador@hq.test'
  `);
}

async function seedFilaPendentes(prefix: string, count: number) {
  const result = await queryDatabase<{ id: string; conversationId: string }>(`
    with inserted as (
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, transcricao,
        audio_url, houve_transferencia, concluido_em, duracao_segundos,
        motivo_contato
      )
      select
        agente.id,
        $1 || '-' || gs::text,
        'concluido',
        '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
        'atendimentos/teste.mp3',
        false,
        timestamptz '2024-01-01T00:00:00Z' + (gs * interval '1 minute'),
        42,
        'Rede credenciada'
      from agentes_voz agente
      cross join generate_series(1, $2::int) as gs
      where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
      returning id, elevenlabs_conversation_id as "conversationId", concluido_em
    ),
    avaliadas as (
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
        nota_qualidade
      )
      select inserted.id, 'ia', p.id, 10,
        true, true, true, true, true, true, true, true, true, 10
      from inserted
      cross join (select id from prompts_ia_avaliadora where ativo limit 1) p
    )
    select id, "conversationId" from inserted order by concluido_em, id
  `, [prefix, count]);
  return result.rows;
}

async function loginUi(page: Page, role: 'admin' | 'gestao' | 'curador') {
  const user = authUsers.find((candidate) => candidate.role === role)!;
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/');
}

async function persistirAvaliacaoIa(
  atendimentoId: string,
  notaQualidade = aprovada.nota_qualidade
) {
  await queryDatabase(`
    select * from persistir_avaliacao_ia(
      $1,
      (select id from prompts_ia_avaliadora where ativo),
      $2::jsonb,
      '[]'::jsonb,
      'Atendimento objetivo.',
      $3,
      $4
    )
  `, [
    atendimentoId,
    JSON.stringify(aprovada.checklist),
    aprovada.atendimento_aprovado,
    notaQualidade
  ]);
}

test.describe.serial('Fila de Curadoria e conferencia humana', () => {
  test.beforeAll(async () => {
    await queryDatabase(`
      insert into agentes_voz (nome, elevenlabs_agent_id)
      values ('Livia', 'agent-livia-curadoria')
      on conflict (elevenlabs_agent_id) do nothing
    `);
  });

  test('fila contem somente Atendimentos concluidos avaliados pela IA e sem conferencia', async ({
    request
  }) => {
    const pendenteId = await createAtendimento('conv-curadoria-pendente');
    const semIaId = await createAtendimento('conv-curadoria-sem-ia');
    const emAndamentoId = await createAtendimento(
      'conv-curadoria-em-andamento',
      'em_andamento'
    );
    await persistirAvaliacaoIa(pendenteId);
    await queryDatabase(`
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
        nota_qualidade
      )
      select $1, 'ia', id, 10,
        true, true, true, true, true, true, true, true, true, 10
      from prompts_ia_avaliadora where ativo
    `, [emAndamentoId]);

    const curador = await login(request, 'curador');
    const response = await request.get(`${apiUrl}/curadoria`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });

    expect(response.status()).toBe(200);
    const fila = (await response.json()) as { items: Array<{ id: string }>; total: number };
    const ids = fila.items.map(({ id }) => id);
    expect(ids).toContain(pendenteId);
    expect(ids).not.toContain(semIaId);
    expect(ids).not.toContain(emAndamentoId);
    expect(fila.total).toBeGreaterThanOrEqual(fila.items.length);
  });

  test('salva correcoes imutaveis, deriva resultado e identifica a revisao mais recente', async ({
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-historico');
    await persistirAvaliacaoIa(atendimentoId);
    const curador = await login(request, 'curador');
    const headers = { authorization: `Bearer ${curador.token}` };
    const detalheInicial = await request.get(
      `${apiUrl}/curadoria/${atendimentoId}`,
      { headers }
    );
    expect(detalheInicial.status()).toBe(200);
    const inicial = (await detalheInicial.json()) as {
      avaliacaoIa: {
        id: string;
        checklist: Array<{ chave: string; estado: string }>;
      };
      avaliacaoMaisRecente: null;
      historico: unknown[];
    };
    expect(inicial.avaliacaoMaisRecente).toBeNull();
    expect(inicial.historico).toEqual([]);

    const primeiraChecklist = inicial.avaliacaoIa.checklist.map((criterio) => ({
      chave: criterio.chave,
      estado:
        criterio.chave === 'informou_protocolo_email'
          ? 'nao_atendido'
          : criterio.estado
    }));
    const primeira = await request.post(
      `${apiUrl}/curadoria/${atendimentoId}/avaliacoes`,
      {
        headers,
        data: {
          checklist: primeiraChecklist,
          notaAvaliacaoIa: 4,
          falhasIdentificadas: ['Protocolo omitido'],
          resumoAtendimento: 'Curador corrigiu o protocolo.',
          comentario: 'IA errou o protocolo.'
        }
      }
    );
    expect(primeira.status()).toBe(201);
    const primeiraAvaliacao = await primeira.json();
    expect(primeiraAvaliacao).toMatchObject({
      autor: { nome: 'Caio Curador' },
      aprovacao: 'reprovado',
      nota: 7,
      avaliacaoIaId: inicial.avaliacaoIa.id,
      notaAvaliacaoIa: 4,
      falhasIdentificadas: ['Protocolo omitido'],
      resumoAtendimento: 'Curador corrigiu o protocolo.',
      comentario: 'IA errou o protocolo.'
    });
    expect(primeiraAvaliacao).not.toHaveProperty('concordou');

    const segunda = await request.post(
      `${apiUrl}/curadoria/${atendimentoId}/avaliacoes`,
      {
        headers,
        data: {
          checklist: inicial.avaliacaoIa.checklist.map(({ chave, estado }) => ({
            chave,
            estado
          })),
          notaAvaliacaoIa: 9,
          falhasIdentificadas: [],
          resumoAtendimento: null
        }
      }
    );
    expect(segunda.status()).toBe(201);
    const segundaAvaliacao = await segunda.json();
    expect(segundaAvaliacao).toMatchObject({
      aprovacao: 'aprovado',
      nota: 9.5,
      notaAvaliacaoIa: 9,
      comentario: null
    });
    expect(segundaAvaliacao.id).not.toBe(primeiraAvaliacao.id);

    const detalheFinal = await request.get(
      `${apiUrl}/curadoria/${atendimentoId}`,
      { headers }
    );
    const final = await detalheFinal.json();
    expect(final.avaliacaoMaisRecente.id).toBe(segundaAvaliacao.id);
    expect(final.historico.map(({ id }: { id: string }) => id)).toEqual([
      segundaAvaliacao.id,
      primeiraAvaliacao.id
    ]);

    const persistidas = await queryDatabase<{
      count: string;
      avaliacaoIaId: string;
    }>(`
      select count(*)::text as count, max(avaliacao_ia_id::text) as "avaliacaoIaId"
      from avaliacoes_curador
      where atendimento_id = $1
    `, [atendimentoId]);
    expect(persistidas.rows[0]?.count).toBe('2');
    expect(persistidas.rows[0]?.avaliacaoIaId).toBe(inicial.avaliacaoIa.id);
    const iaIntacta = await queryDatabase<{ count: string }>(`
      select count(*)::text as count from avaliacoes
      where atendimento_id = $1 and autor = 'ia'
    `, [atendimentoId]);
    expect(iaIntacta.rows[0]?.count).toBe('1');
    await expect(
      queryDatabase('update avaliacoes_curador set nota = 0 where id = $1', [
        primeiraAvaliacao.id
      ])
    ).rejects.toThrow(/imutavel/i);
    await expect(
      queryDatabase('delete from avaliacoes_curador where id = $1', [
        primeiraAvaliacao.id
      ])
    ).rejects.toThrow(/imutavel/i);
    await expect(
      queryDatabase(
        `update avaliacao_curador_criterios
         set estado = 'atendido'
         where avaliacao_curador_id = $1`,
        [primeiraAvaliacao.id]
      )
    ).rejects.toThrow(/imutavel/i);

    const fila = await request.get(`${apiUrl}/curadoria`, { headers });
    const filaBody = (await fila.json()) as { items: Array<{ id: string }> };
    expect(filaBody.items.map(({ id }) => id)).not.toContain(atendimentoId);

    await queryDatabase(
      `update atendimentos
       set concluido_em = '2025-01-15T12:00:00Z'
       where id = $1`,
      [atendimentoId]
    );
    const concordancia = await queryDatabase<{ avaliacaoId: string }>(
      `select recente.id as "avaliacaoId"
       from atendimentos atendimento
       join avaliacoes_curador_mais_recentes recente
         on recente.atendimento_id = atendimento.id
       where atendimento.concluido_em >= '2025-01-01T00:00:00Z'
         and atendimento.concluido_em < '2025-02-01T00:00:00Z'
         and atendimento.id = $1`,
      [atendimentoId]
    );
    expect(concordancia.rows[0]?.avaliacaoId).toBe(segundaAvaliacao.id);
  });

  test('Gestao nao escreve e Atendimento em andamento nao pode ser avaliado', async ({
    request
  }) => {
    const atendimentoId = await createAtendimento(
      'conv-curadoria-bloqueado',
      'em_andamento'
    );
    await queryDatabase(`
      with avaliacao as (
        insert into avaliacoes (
          atendimento_id, autor, prompt_id, nota,
          saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
          resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
          encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
          nota_qualidade
        )
        select $1, 'ia', id, 10,
          true, true, true, true, true, true, true, true, true, 10
        from prompts_ia_avaliadora where ativo
        returning id
      )
      insert into avaliacao_criterios (
        avaliacao_id, criterio_id, criterio_chave, criterio_nome,
        criterio_critico, criterio_ordem, estado, valor_criterio
      )
      select avaliacao.id, c.id, c.chave, c.nome, c.critico, c.ordem,
        'atendido', c.valor
      from avaliacao cross join criterios c where c.ativo
    `, [atendimentoId]);
    const checklist = Object.keys(aprovada.checklist).map((chave) => ({
      chave,
      estado: 'atendido'
    }));

    const gestao = await login(request, 'gestao');
    const leituraFila = await request.get(`${apiUrl}/curadoria`, {
      headers: { authorization: `Bearer ${gestao.token}` }
    });
    expect(leituraFila.status()).toBe(200);
    const leituraDetalhe = await request.get(
      `${apiUrl}/curadoria/${atendimentoId}`,
      { headers: { authorization: `Bearer ${gestao.token}` } }
    );
    expect(leituraDetalhe.status()).toBe(200);

    const forbidden = await request.post(
      `${apiUrl}/curadoria/${atendimentoId}/avaliacoes`,
      {
        headers: { authorization: `Bearer ${gestao.token}` },
        data: { checklist, notaAvaliacaoIa: 8 }
      }
    );
    expect(forbidden.status()).toBe(403);

    const admin = await login(request, 'admin');
    const conflict = await request.post(
      `${apiUrl}/curadoria/${atendimentoId}/avaliacoes`,
      {
        headers: { authorization: `Bearer ${admin.token}` },
        data: { checklist, notaAvaliacaoIa: 8 }
      }
    );
    expect(conflict.status()).toBe(409);

    const concluidoId = await createAtendimento('conv-curadoria-admin');
    await persistirAvaliacaoIa(concluidoId);
    const salvoPorAdmin = await request.post(
      `${apiUrl}/curadoria/${concluidoId}/avaliacoes`,
      {
        headers: { authorization: `Bearer ${admin.token}` },
        data: { checklist, notaAvaliacaoIa: 8, comentario: null }
      }
    );
    expect(salvoPorAdmin.status()).toBe(201);
    await expect(salvoPorAdmin.json()).resolves.toMatchObject({
      autor: { nome: 'Ana Admin' }
    });
  });

  test('gate: ferramentas nao atendidas forca resolucao nao atendida na conferencia', async ({
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-gate-ferramentas');
    await persistirAvaliacaoIa(atendimentoId);
    const curador = await login(request, 'curador');
    const headers = { authorization: `Bearer ${curador.token}` };
    const detalhe = await request.get(`${apiUrl}/curadoria/${atendimentoId}`, {
      headers
    });
    const inicial = (await detalhe.json()) as {
      avaliacaoIa: { checklist: Array<{ chave: string; estado: string }> };
    };

    const response = await request.post(
      `${apiUrl}/curadoria/${atendimentoId}/avaliacoes`,
      {
        headers,
        data: {
          checklist: inicial.avaliacaoIa.checklist.map((criterio) => ({
            chave: criterio.chave,
            estado:
              criterio.chave === 'uso_correto_ferramentas'
                ? 'nao_atendido'
                : criterio.chave === 'resolveu_solicitacao'
                  ? 'atendido'
                  : criterio.estado
          })),
          notaAvaliacaoIa: 9.5,
          falhasIdentificadas: ['Ferramenta incorreta'],
          resumoAtendimento: 'Gate de ferramentas aplicado.'
        }
      }
    );
    expect(response.status()).toBe(201);
    const avaliacao = await response.json();
    expect(avaliacao.nota).toBe(6.5);
    expect(avaliacao.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chave: 'uso_correto_ferramentas',
          estado: 'nao_atendido'
        }),
        expect.objectContaining({
          chave: 'resolveu_solicitacao',
          estado: 'nao_atendido'
        })
      ])
    );
  });

  async function expectSecoesDaRevisaoNaOrdem(page: Page) {
    await expect(page.getByRole('region', { name: 'Dados do Atendimento' })).toBeVisible();
    const headings = await page.locator('main h2').allTextContents();
    const headingIndex = (name: string) => {
      expect(headings).toContain(name);
      return headings.findIndex((text) => text.trim() === name);
    };

    expect(headingIndex('Avaliação original')).toBeLessThan(headingIndex('Transcrição'));
    expect(headingIndex('Transcrição')).toBeLessThan(headingIndex('Ouça antes de decidir'));
    expect(headingIndex('Ouça antes de decidir')).toBeLessThan(headingIndex('Conferência humana'));
    expect(headingIndex('Conferência humana')).toBeLessThan(headingIndex('Revisão mais recente'));
    expect(headingIndex('Revisão mais recente')).toBeLessThan(headingIndex('Comentários'));
    await expect(page.getByText('Tempo de Espera', { exact: true })).toHaveCount(0);
    await expect(page.getByText('TME', { exact: true })).toHaveCount(0);
  }

  test('Gestao consulta a conferencia pela interface sem acao de escrita', async ({
    page
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-gestao');
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('gestao@hq.test');
    await page.getByLabel('Senha').fill('senha-gestao');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/curadoria/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    await expect(page.getByText('Consulta somente leitura')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar conferência' })).toHaveCount(0);
    await expectSecoesDaRevisaoNaOrdem(page);
  });

  test('Curador confere o checklist da IA pela interface e consulta o historico', async ({
    page
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-interface');
    // nota_qualidade 4 ≠ Régua 9,5 — o input deve copiar Nota da IA, não o claim da LLM.
    await persistirAvaliacaoIa(atendimentoId, 4);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/curadoria');

    await expect(page.getByRole('heading', { name: 'Fila de Curadoria' })).toBeVisible();
    await page.getByRole('link', { name: /conv-curadoria-interface/ }).click();
    await expect(page.getByRole('heading', { name: 'Conferência humana' })).toBeVisible();
    await expectSecoesDaRevisaoNaOrdem(page);
    const notaReguaExibida = page
      .getByRole('region', { name: 'Dados do Atendimento' })
      .locator('div')
      .filter({ hasText: /^Nota da IA/ })
      .locator('strong');
    await expect(notaReguaExibida).toHaveText('9,5');
    const notaAvaliacaoIa = page.getByLabel('Nota da Avaliação da IA');
    await expect(notaAvaliacaoIa).toHaveValue('9.5');
    await expect(page.getByText('Uso Correto de Ferramentas')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Avaliação original' }).locator('..').getByText('Atendimento objetivo.')
    ).toBeVisible();
    await expect(page.getByText('Ola')).toBeVisible();

    const protocolo = page.getByRole('group', { name: /Informação de Protocolo/ });
    await protocolo.getByLabel('Não atendido').check();
    await expect(page.getByText('Reprovado', { exact: true })).toBeVisible();
    await notaAvaliacaoIa.fill('11');
    await expect(page.getByRole('button', { name: 'Salvar conferência' })).toBeDisabled();
    await notaAvaliacaoIa.fill('3');
    await expect(page.getByRole('button', { name: 'Salvar conferência' })).toBeEnabled();
    await page.getByLabel('Comentário da revisão (opcional)').fill('Corrigir protocolo.');
    await page.getByRole('button', { name: 'Salvar conferência' }).click();

    await expect(page.getByRole('heading', { name: 'Fila de Curadoria' })).toBeVisible();
    await expect(page.getByRole('link', { name: /conv-curadoria-interface/ })).toHaveCount(0);

    await page.goto(`/curadoria/${atendimentoId}`);
    await expect(page.getByRole('heading', { name: 'Revisão mais recente' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Caio Curador')).toBeVisible();
    await expect(page.getByText('1 revisão')).toBeVisible();
    const revisaoRecente = page
      .locator('.review-history article')
      .filter({ hasText: 'Caio Curador' });
    await expect(revisaoRecente.getByText('Nota da Avaliação da IA:')).toBeVisible();
    await expect(revisaoRecente.getByText('3', { exact: true })).toBeVisible();
    await expect(revisaoRecente.getByText('Corrigir protocolo.')).toBeVisible();
    await expect(revisaoRecente.getByText('Não atendido').first()).toBeVisible();

    const protocoloSalvo = page.getByRole('group', { name: /Informação de Protocolo/ });
    await protocoloSalvo.getByLabel('Atendido', { exact: true }).check();
    await page.getByLabel('Nota da Avaliação da IA').fill('8');
    await page.getByLabel('Comentário da revisão (opcional)').fill('');
    await page.getByRole('button', { name: 'Salvar conferência' }).click();
    await expect(page.getByRole('heading', { name: 'Fila de Curadoria' })).toBeVisible();

    await page.goto(`/curadoria/${atendimentoId}`);
    await expect(page.getByText('2 revisões')).toBeVisible();

    await page.getByText('Consultar revisões anteriores').click();
    const anterior = page.locator('.review-history details li').first();
    await expect(anterior).toContainText('Informação de Protocolo');
    await expect(anterior).toContainText('Não atendido');
  });

  test('formulário de curadoria exibe tag crítico alinhada ao título e custom tooltip com descrição no hover/focus', async ({
    page,
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-tooltip-layout');
    await persistirAvaliacaoIa(atendimentoId);

    const curador = await login(request, 'curador');
    const detalheRes = await request.get(`${apiUrl}/curadoria/${atendimentoId}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });
    expect(detalheRes.status()).toBe(200);
    const detalheJson = await detalheRes.json();
    const protocoloCriterio = detalheJson.avaliacaoIa.checklist.find(
      (c: { chave: string }) => c.chave === 'informou_protocolo_email'
    );
    expect(protocoloCriterio).toBeDefined();
    expect(protocoloCriterio.descricao).toBeTruthy();

    await loginUi(page, 'curador');
    await page.goto(`/curadoria/${atendimentoId}`);

    const fieldset = page.locator('fieldset').filter({ hasText: 'Informação de Protocolo' });
    await expect(fieldset).toBeVisible();

    // Tag Crítico está presente e agrupada na legenda ao lado do título
    const legend = fieldset.locator('legend');
    await expect(legend.getByText('Crítico')).toBeVisible();
    await expect(legend.locator('.criterion-critical-badge')).toBeVisible();

    // Botões de opção permanecem no mesmo fieldset
    const options = fieldset.locator('.criterion-options');
    await expect(options).toBeVisible();
    await expect(options.getByText('Atendido', { exact: true })).toBeVisible();
    await expect(options.getByText('Não atendido', { exact: true })).toBeVisible();

    // Tooltip inicialmente não está visível
    const tooltip = page.locator('.criterion-tooltip');
    await expect(tooltip).toHaveCount(0);

    // Hover sobre o nome do critério exibe o custom tooltip com a descrição
    const trigger = fieldset.locator('.criterion-tooltip-trigger');
    await trigger.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(protocoloCriterio.descricao);

    // Tirar o mouse oculta o tooltip
    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);

    // Foco via teclado no trigger exibe o tooltip
    await trigger.focus();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(protocoloCriterio.descricao);

    // Pressionar Escape oculta o tooltip
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
  });

  test('transcrição longa na revisão rola dentro do painel', async ({ page }) => {
    const atendimentoId = await createAtendimento(
      'conv-curadoria-transcricao-longa',
      'concluido',
      longTranscript()
    );
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/curadoria/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Transcrição' })).toBeVisible();
    await expect.poll(async () => transcriptOverflows(transcriptScroll(page))).toBe(true);
  });

  test('transcrição curta na revisão não ganha caixa vazia nem barra de rolagem', async ({
    page
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-transcricao-curta');
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/curadoria/${atendimentoId}`);

    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    await expect(page.getByText('Ola')).toBeVisible();
    const scroll = transcriptScroll(page);
    await expect.poll(async () => transcriptOverflows(scroll)).toBe(false);
    expect(await firstTurnFitsWithoutEmptyBox(scroll)).toBe(true);
  });

  test('player na revisão da Curadoria controla áudio real, avança/retorna 30s e busca pela barra de progresso', async ({
    page
  }) => {
    const transcript = [
      { role: 'agent' as const, message: 'Olá! Sou a Lívia da GEAP.', time_in_call_secs: 0 },
      { role: 'user' as const, message: 'Preciso da segunda via do boleto.', time_in_call_secs: 15 },
      { role: 'agent' as const, message: 'Vou consultar o sistema para você.', time_in_call_secs: 35 },
      { role: 'user' as const, message: 'Muito obrigado pela ajuda.', time_in_call_secs: 55 }
    ];
    const atendimentoId = await createAtendimento(
      'conv-curadoria-player-sync',
      'concluido',
      transcript
    );
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/curadoria/${atendimentoId}`);

    const player = page.getByTestId('audio-player');
    await expect(player).toBeVisible();
    const playBtn = page.getByRole('button', { name: 'Reproduzir áudio' });
    await expect(playBtn).toBeVisible();

    await playBtn.click();
    await expect(page.getByRole('button', { name: 'Pausar áudio' })).toBeVisible();
    await page.getByRole('button', { name: 'Pausar áudio' }).click();
    await expect(page.getByRole('button', { name: 'Reproduzir áudio' })).toBeVisible();

    const forwardBtn = page.getByRole('button', { name: 'Avançar 30 segundos' });
    await forwardBtn.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:30');
    await expect(page.getByTestId('transcript-turn-1')).toHaveClass(/active/);

    const backBtn = page.getByRole('button', { name: 'Voltar 30 segundos' });
    await backBtn.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:00');
    await expect(page.getByTestId('transcript-turn-0')).toHaveClass(/active/);

    const progressBar = page.getByTestId('audio-progress-bar');
    await progressBar.fill('35');
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:35');
    await expect(page.getByTestId('transcript-turn-2')).toHaveClass(/active/);
  });

  test('sincronia na revisão: clique no turno faz seek, ferramentas sao exibidas legivelmente sem caixas vazias e scroll manual pausa auto-scroll', async ({
    page
  }) => {
    const transcript = [
      { role: 'agent' as const, message: 'Olá, sou a Lívia.', time_in_call_secs: 0 },
      { role: 'user' as const, message: 'Preciso de atendimento.', time_in_call_secs: 10 },
      {
        role: 'agent' as const,
        message:
          '[Chamada de Ferramenta: consultar_cadastro]\n[Resultado da Ferramenta: consultar_cadastro - Sucesso]',
        time_in_call_secs: 22
      },
      { role: 'agent' as const, message: 'Localizei seus dados no cadastro.', time_in_call_secs: 32 },
      { role: 'user' as const, message: 'Excelente.', time_in_call_secs: 42 },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'agent' : 'user') as 'agent' | 'user',
        message: `Turno adicional ${i + 5} de acompanhamento na revisão.`,
        time_in_call_secs: 50 + i * 5
      }))
    ];
    const atendimentoId = await createAtendimento(
      'conv-curadoria-toolcall-sync',
      'concluido',
      transcript
    );
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto(`/curadoria/${atendimentoId}`);

    // Não deve renderizar caixas pontilhadas vazias
    await expect(page.locator('.transcript-empty-box')).toHaveCount(0);
    await expect(page.getByTestId('transcript-tool-call')).toHaveCount(0);

    // Mensagens descritivas de ferramentas são exibidas legivelmente
    await expect(page.getByText('[Chamada de Ferramenta: consultar_cadastro]')).toBeVisible();
    await expect(
      page.getByText('[Resultado da Ferramenta: consultar_cadastro - Sucesso]')
    ).toBeVisible();

    // Clique no turno de ferramenta move o player para o segundo exato
    const toolCallTurn = page.getByTestId('transcript-turn-2');
    await toolCallTurn.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:22');
    await expect(toolCallTurn).toHaveClass(/active/);

    // Clique em outro turno move o player para o segundo exato
    const turn3 = page.getByTestId('transcript-turn-3');
    await turn3.click();
    await expect(page.getByTestId('audio-current-time')).toHaveText('00:32');
    await expect(turn3).toHaveClass(/active/);

    // Scroll manual pausa o auto-scroll e exibe o botão "Voltar ao momento atual"
    const scroll = transcriptScroll(page);
    await scroll.hover();
    await page.mouse.wheel(0, 300);

    const resumeBtn = page.getByRole('button', { name: 'Voltar ao momento atual' });
    await expect(resumeBtn).toBeVisible();

    // Clicar em "Voltar ao momento atual" retoma o scroll e esconde o botão
    await resumeBtn.click();
    await expect(resumeBtn).toBeHidden();
    await expect(turn3).toHaveClass(/active/);
  });

  test('fila mostra no maximo 50, badge desta pagina e numeros clicaveis', async ({
    page
  }) => {
    await esvaziarFila();
    await seedFilaPendentes('conv-fila-numeros', 101);
    await loginUi(page, 'curador');
    await page.goto('/curadoria');

    const rows = page
      .getByRole('region', { name: 'Atendimentos pendentes' })
      .getByRole('article');
    const pager = page.getByRole('navigation', {
      name: 'Paginação da Fila de Curadoria'
    });
    await expect(rows).toHaveCount(50);
    await expect(page.getByText('50 pendentes')).toBeVisible();
    await expect(pager.getByLabel('Página 1')).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(pager.getByRole('link', { name: 'Página 2' })).toBeVisible();
    await expect(pager.getByRole('link', { name: 'Página 3' })).toBeVisible();
    await expect(pager.getByRole('link', { name: 'Página 4' })).toHaveCount(0);

    await pager.getByRole('link', { name: 'Página 3' }).click();
    await expect(page).toHaveURL(/[?&]page=3/);
    await expect(rows).toHaveCount(1);
    await expect(page.getByText('1 pendente', { exact: true })).toBeVisible();

    await pager.getByRole('link', { name: 'Página 1' }).click();
    await expect(page).toHaveURL('/curadoria');
    await expect(rows).toHaveCount(50);
  });

  test('Voltar à fila devolve à pagina de origem', async ({ page }) => {
    await esvaziarFila();
    const seeded = await seedFilaPendentes('conv-fila-voltar', 51);
    const pageTwoItem = seeded[50]!;
    await loginUi(page, 'curador');
    await page.goto('/curadoria?page=2');
    await page.getByRole('link', { name: pageTwoItem.conversationId }).click();
    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar à fila' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(
      page.getByRole('link', { name: pageTwoItem.conversationId })
    ).toBeVisible();
  });

  test('salvar o ultimo da ultima pagina recua para a anterior', async ({
    page
  }) => {
    await esvaziarFila();
    const seeded = await seedFilaPendentes('conv-fila-recuo', 51);
    const last = seeded[50]!;
    await loginUi(page, 'curador');
    await page.goto('/curadoria?page=2');
    await page.getByRole('link', { name: last.conversationId }).click();
    await page.getByRole('button', { name: 'Salvar conferência' }).click();
    await expect(page.getByRole('heading', { name: 'Fila de Curadoria' })).toBeVisible();
    await expect(page).toHaveURL('/curadoria');
    await expect(page.getByText('50 pendentes')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Paginação da Fila de Curadoria' })
    ).toHaveCount(0);
  });

  test('salvar o ultimo pendente da pagina 1 mostra Fila em dia', async ({
    page
  }) => {
    await esvaziarFila();
    const [only] = await seedFilaPendentes('conv-fila-em-dia', 1);
    await loginUi(page, 'curador');
    await page.goto('/curadoria');
    await expect(page.getByText('1 pendente', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: only!.conversationId }).click();
    await page.getByRole('button', { name: 'Salvar conferência' }).click();
    await expect(page.getByRole('heading', { name: 'Fila em dia' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Paginação da Fila de Curadoria' })
    ).toHaveCount(0);
  });

  test('deep link sem origem volta para a pagina 1', async ({ page }) => {
    await esvaziarFila();
    const [only] = await seedFilaPendentes('conv-fila-deeplink', 1);
    await loginUi(page, 'curador');
    await page.goto(`/curadoria/${only!.id}`);
    await page.getByRole('link', { name: 'Voltar à fila' }).click();
    await expect(page).toHaveURL('/curadoria');
  });

  test('Gestao pagina a fila e segue sem Salvar conferencia', async ({
    page
  }) => {
    await esvaziarFila();
    const seeded = await seedFilaPendentes('conv-fila-gestao', 51);
    await loginUi(page, 'gestao');
    await page.goto('/curadoria');
    await expect(page.getByRole('link', { name: 'Página 2' })).toBeVisible();
    await page.getByRole('link', { name: 'Página 2' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await page.getByRole('link', { name: seeded[50]!.conversationId }).click();
    await expect(page.getByRole('button', { name: 'Salvar conferência' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Voltar à fila' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
  });

  test('Admin pagina a mesma Fila de Curadoria', async ({ page }) => {
    await esvaziarFila();
    await seedFilaPendentes('conv-fila-admin', 51);
    await loginUi(page, 'admin');
    await page.goto('/curadoria');
    await expect(page.getByText('50 pendentes')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Página 2' })).toBeVisible();
  });

  test('pagina alem de totalPages recua para uma pagina valida', async ({
    page
  }) => {
    await esvaziarFila();
    await seedFilaPendentes('conv-fila-clamp', 51);
    await loginUi(page, 'curador');
    await page.goto('/curadoria?page=999');
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByText('1 pendente', { exact: true })).toBeVisible();
  });

  test('endpoint /atendimentos/motivos expoe motivos distintos registrados incluindo Nao informado', async ({
    request
  }) => {
    await createAtendimento('conv-motivo-test-rede', 'concluido');
    await queryDatabase(`
      insert into atendimentos (
        agente_voz_id, elevenlabs_conversation_id, status, transcricao,
        audio_url, houve_transferencia, concluido_em, duracao_segundos,
        motivo_contato
      )
      select id, 'conv-motivo-test-sem', 'concluido'::status_atendimento,
        '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
        'atendimentos/teste.mp3', false, now(), 42, null
      from agentes_voz
      where elevenlabs_agent_id = 'agent-livia-curadoria'
      limit 1
    `);
    const curador = await login(request, 'curador');
    const response = await request.get(`${apiUrl}/atendimentos/motivos`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });
    expect(response.status()).toBe(200);
    const motivos = (await response.json()) as string[];
    expect(Array.isArray(motivos)).toBe(true);
    expect(motivos).toContain('Rede credenciada');
    expect(motivos).toContain('Não informado');
  });

  test('filtra a Fila de Curadoria por dia unico e por periodo', async ({
    page
  }) => {
    await esvaziarFila();
    await queryDatabase(`
      with inserted as (
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, transcricao,
          audio_url, houve_transferencia, concluido_em, duracao_segundos,
          motivo_contato
        )
        select
          agente.id,
          t.conv_id,
          'concluido',
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3',
          false,
          t.concluido::timestamptz,
          42,
          'Rede credenciada'
        from agentes_voz agente
        cross join (
          values
            ('conv-data-10', '2024-01-10T12:00:00Z'),
            ('conv-data-15', '2024-01-15T12:00:00Z'),
            ('conv-data-20', '2024-01-20T12:00:00Z')
        ) as t(conv_id, concluido)
        where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
        returning id
      )
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
        nota_qualidade
      )
      select inserted.id, 'ia', p.id, 10,
        true, true, true, true, true, true, true, true, true, 10
      from inserted
      cross join (select id from prompts_ia_avaliadora where ativo limit 1) p
    `);

    await loginUi(page, 'curador');
    await page.goto('/curadoria');
    await expect(page.getByText('3 pendentes')).toBeVisible();

    // Filtro de dia único (só Data inicial preenchida)
    await page.getByLabel('Data inicial').fill('2024-01-15');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/[?&]inicio=2024-01-15/);
    await expect(page.getByText('1 pendente', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-data-15' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-data-10' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'conv-data-20' })).toHaveCount(0);

    // Filtro por período (Data inicial + Data final)
    await page.getByLabel('Data inicial').fill('2024-01-10');
    await page.getByLabel('Data final (opcional)').fill('2024-01-15');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/[?&]inicio=2024-01-10/);
    await expect(page).toHaveURL(/[?&]fim=2024-01-15/);
    await expect(page.getByText('2 pendentes')).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-data-10' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-data-15' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-data-20' })).toHaveCount(0);

    // Limpar filtros restaura lista completa
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL('/curadoria');
    await expect(page.getByText('3 pendentes')).toBeVisible();
  });

  test('filtro de dia respeita o dia civil de America/Sao_Paulo', async ({
    page
  }) => {
    await esvaziarFila();
    // 2024-01-01T01:30:00Z em UTC equivale a 2023-12-31T22:30:00 em America/Sao_Paulo (UTC-3)
    await queryDatabase(`
      with inserted as (
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, transcricao,
          audio_url, houve_transferencia, concluido_em, duracao_segundos,
          motivo_contato
        )
        select
          agente.id,
          'conv-sp-fuso',
          'concluido',
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3',
          false,
          '2024-01-01T01:30:00Z'::timestamptz,
          42,
          'Rede credenciada'
        from agentes_voz agente
        where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
        returning id
      )
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
        nota_qualidade
      )
      select inserted.id, 'ia', p.id, 10,
        true, true, true, true, true, true, true, true, true, 10
      from inserted
      cross join (select id from prompts_ia_avaliadora where ativo limit 1) p
    `);

    await loginUi(page, 'curador');
    await page.goto('/curadoria');

    // Filtrando pelo dia civil de SP (2023-12-31) encontra o atendimento
    await page.getByLabel('Data inicial').fill('2023-12-31');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByRole('link', { name: 'conv-sp-fuso' })).toBeVisible();
    await expect(page.getByText('1 pendente', { exact: true })).toBeVisible();

    // Filtrando pelo dia civil seguinte em SP (2024-01-01) NÃO encontra
    await page.getByLabel('Data inicial').fill('2024-01-01');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByRole('link', { name: 'conv-sp-fuso' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Nenhum Atendimento encontrado' })).toBeVisible();
  });

  test('combobox de motivo sugere motivos distintos e aceita valor fora da lista', async ({
    page
  }) => {
    await esvaziarFila();
    await queryDatabase(`
      with inserted as (
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, transcricao,
          audio_url, houve_transferencia, concluido_em, duracao_segundos,
          motivo_contato
        )
        select
          agente.id,
          t.conv_id,
          'concluido',
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3',
          false,
          now(),
          42,
          t.motivo
        from agentes_voz agente
        cross join (
          values
            ('conv-motivo-rede', 'Rede credenciada'),
            ('conv-motivo-fin', 'Financeiro/Boletos'),
            ('conv-motivo-sem', null)
        ) as t(conv_id, motivo)
        where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
        returning id
      )
      insert into avaliacoes (
        atendimento_id, autor, prompt_id, nota,
        saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
        resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
        encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
        nota_qualidade
      )
      select inserted.id, 'ia', p.id, 10,
        true, true, true, true, true, true, true, true, true, 10
      from inserted
      cross join (select id from prompts_ia_avaliadora where ativo limit 1) p
    `);

    await loginUi(page, 'curador');
    await page.goto('/curadoria');
    await expect(page.getByText('3 pendentes')).toBeVisible();

    // Typeahead do combobox sugere motivos distintos
    const combobox = page.getByRole('combobox', { name: 'Motivo de Contato' });
    await combobox.fill('Fin');
    await expect(page.getByRole('option', { name: 'Financeiro/Boletos' })).toBeVisible();
    await page.getByRole('option', { name: 'Financeiro/Boletos' }).click();
    await expect(combobox).toHaveValue('Financeiro/Boletos');
    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/[?&]motivo=Financeiro%2FBoletos/);
    await expect(page.getByRole('link', { name: 'conv-motivo-fin' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-motivo-rede' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'conv-motivo-sem' })).toHaveCount(0);

    // Sugestão e filtro com Não informado (busca sem acento 'nao')
    await combobox.fill('nao');
    await expect(page.getByRole('option', { name: 'Não informado' })).toBeVisible();
    await page.getByRole('option', { name: 'Não informado' }).click();
    await expect(combobox).toHaveValue('Não informado');
    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/[?&]motivo=N%C3%A3o(\+|%20)informado|motivo=Nao(\+|%20)informado/);
    await expect(page.getByRole('link', { name: 'conv-motivo-sem' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-motivo-fin' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'conv-motivo-rede' })).toHaveCount(0);
    await expect(page.getByText('Não informado')).toBeVisible();

    // Aceita digitação livre fora da lista
    await combobox.fill('Motivo Inexistente Na Base');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByRole('heading', { name: 'Nenhum Atendimento encontrado' })).toBeVisible();
  });

  test('combina filtros de dia, motivo e paginacao preservando parametros na navegacao', async ({
    page
  }) => {
    await esvaziarFila();
    // Seed 51 com Rede credenciada no dia 2024-01-15 e 2 com outro motivo/dia
    await queryDatabase(`
      with inserted as (
        insert into atendimentos (
          agente_voz_id, elevenlabs_conversation_id, status, transcricao,
          audio_url, houve_transferencia, concluido_em, duracao_segundos,
          motivo_contato
        )
        select
          agente.id,
          'conv-combo-' || gs::text,
          'concluido'::status_atendimento,
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3',
          false,
          timestamptz '2024-01-15T10:00:00Z' + (gs * interval '1 minute'),
          42,
          'Rede credenciada'
        from agentes_voz agente
        cross join generate_series(1, 51) as gs
        where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
        union all
        select
          agente.id,
          'conv-outro-dia',
          'concluido'::status_atendimento,
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3',
          false,
          timestamptz '2024-01-20T10:00:00Z',
          42,
          'Rede credenciada'
        from agentes_voz agente
        where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
        union all
        select
          agente.id,
          'conv-outro-motivo',
          'concluido'::status_atendimento,
          '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
          'atendimentos/teste.mp3',
          false,
          timestamptz '2024-01-15T10:00:00Z',
          42,
          'Cancelamento'
        from agentes_voz agente
        where agente.elevenlabs_agent_id = 'agent-livia-curadoria'
        returning id, elevenlabs_conversation_id as "conversationId", concluido_em
      ),
      avaliadas as (
        insert into avaliacoes (
          atendimento_id, autor, prompt_id, nota,
          saudacao_e_intencao, solicitou_cpf, informou_protocolo_email,
          resolveu_solicitacao, validou_email_por_extenso, sem_diminutivos,
          encerramento_geap, uso_correto_ferramentas, atendimento_aprovado,
          nota_qualidade
        )
        select inserted.id, 'ia', p.id, 10,
          true, true, true, true, true, true, true, true, true, 10
        from inserted
        cross join (select id from prompts_ia_avaliadora where ativo limit 1) p
      )
      select id from inserted
    `);

    await loginUi(page, 'curador');
    await page.goto('/curadoria');

    // Aplica filtros combinados: Dia 2024-01-15 e Motivo Rede credenciada
    await page.getByLabel('Data inicial').fill('2024-01-15');
    const combobox = page.getByRole('combobox', { name: 'Motivo de Contato' });
    await combobox.fill('Rede');
    await page.getByRole('option', { name: 'Rede credenciada' }).first().click();
    await page.getByRole('button', { name: 'Filtrar' }).click();

    // 51 itens batem o filtro -> 50 na página 1, 1 na página 2
    await expect(page.getByText('50 pendentes')).toBeVisible();
    const pager = page.getByRole('navigation', {
      name: 'Paginação da Fila de Curadoria'
    });
    await expect(pager.getByRole('link', { name: 'Página 2' })).toBeVisible();

    // Navega para página 2 preservando filtros
    await pager.getByRole('link', { name: 'Página 2' }).click();
    await expect(page).toHaveURL(/[?&]inicio=2024-01-15/);
    await expect(page).toHaveURL(/[?&]motivo=Rede/);
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByText('1 pendente', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'conv-combo-51' })).toBeVisible();

    // Clica para revisar e volta à fila preservando a página 2 e filtros
    await page.getByRole('link', { name: 'conv-combo-51' }).click();
    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar à fila' }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page).toHaveURL(/[?&]inicio=2024-01-15/);
    await expect(page).toHaveURL(/[?&]motivo=Rede/);
    await expect(page.getByRole('link', { name: 'conv-combo-51' })).toBeVisible();
  });

  test('endpoint GET /curadorias-realizadas lista conferencias e aplica filtros de periodo, motivo e curadorId', async ({
    request
  }) => {
    // Cria um segundo curador
    const curador2Result = await queryDatabase<{ id: string }>(`
      insert into usuarios (email, nome, senha_hash, papel)
      values ('curadora2@hq.test', 'Bruna Curadora', '$2b$10$dummyhash', 'curador')
      on conflict (lower(email)) do update set nome = 'Bruna Curadora'
      returning id
    `);
    const curador2Id = curador2Result.rows[0]!.id;

    const at1Id = await createAtendimento('conv-realizada-caio');
    const at2Id = await createAtendimento('conv-realizada-bruna');
    await persistirAvaliacaoIa(at1Id);
    await persistirAvaliacaoIa(at2Id);

    const caio = await login(request, 'curador');
    const gestao = await login(request, 'gestao');

    // Caio realiza conferência do at1
    const caioUser = await queryDatabase<{ id: string }>(
      "select id from usuarios where email = 'curador@hq.test'"
    );
    const caioId = caioUser.rows[0]!.id;

    const detalhe1 = await request.get(`${apiUrl}/curadoria/${at1Id}`, {
      headers: { authorization: `Bearer ${caio.token}` }
    });
    const d1 = (await detalhe1.json()) as { avaliacaoIa: { id: string; checklist: Array<{ chave: string; estado: string }> } };
    await request.post(`${apiUrl}/curadoria/${at1Id}/avaliacoes`, {
      headers: { authorization: `Bearer ${caio.token}` },
      data: {
        checklist: d1.avaliacaoIa.checklist.map((c) => ({ chave: c.chave, estado: c.estado })),
        notaAvaliacaoIa: 9,
        falhasIdentificadas: [],
        resumoAtendimento: 'Conferido por Caio'
      }
    });

    // Bruna realiza conferência do at2
    const detalhe2 = await request.get(`${apiUrl}/curadoria/${at2Id}`, {
      headers: { authorization: `Bearer ${gestao.token}` }
    });
    const d2 = (await detalhe2.json()) as { avaliacaoIa: { id: string; checklist: Array<{ chave: string; estado: string }> } };

    await queryDatabase(`
      insert into avaliacoes_curador (
        atendimento_id, avaliacao_ia_id, autor_usuario_id, autor_usuario_nome,
        nota, falhas_identificadas, resumo_atendimento, nota_avaliacao_ia
      )
      values ($1, $2, $3, 'Bruna Curadora', 9.5, '[]'::jsonb, 'Conferido por Bruna', 9)
    `, [at2Id, d2.avaliacaoIa.id, curador2Id]);

    // Curador consulta /curadorias-realizadas -> padrão é ver apenas as suas
    const resCurador = await request.get(`${apiUrl}/curadorias-realizadas`, {
      headers: { authorization: `Bearer ${caio.token}` }
    });
    expect(resCurador.status()).toBe(200);
    const bodyCurador = (await resCurador.json()) as { items: Array<{ id: string; curadorNome: string }> };
    const curadorItemsIds = bodyCurador.items.map((it) => it.id);
    expect(curadorItemsIds).toContain(at1Id);
    expect(curadorItemsIds).not.toContain(at2Id);

    // Gestão consulta /curadorias-realizadas -> vê todas
    const resGestao = await request.get(`${apiUrl}/curadorias-realizadas`, {
      headers: { authorization: `Bearer ${gestao.token}` }
    });
    expect(resGestao.status()).toBe(200);
    const bodyGestao = (await resGestao.json()) as { items: Array<{ id: string; curadorNome: string }> };
    const gestaoItemsIds = bodyGestao.items.map((it) => it.id);
    expect(gestaoItemsIds).toContain(at1Id);
    expect(gestaoItemsIds).toContain(at2Id);

    // Gestão filtra por curadorId de Bruna
    const resGestaoBruna = await request.get(
      `${apiUrl}/curadorias-realizadas?curadorId=${curador2Id}`,
      { headers: { authorization: `Bearer ${gestao.token}` } }
    );
    expect(resGestaoBruna.status()).toBe(200);
    const bodyBruna = (await resGestaoBruna.json()) as { items: Array<{ id: string }> };
    const brunaIds = bodyBruna.items.map((it) => it.id);
    expect(brunaIds).toContain(at2Id);
    expect(brunaIds).not.toContain(at1Id);
  });

  test('Curador acessa Minhas Curadorias na Casca e abre detalhe em modo conferencia', async ({
    page,
    request
  }) => {
    const atendimentoId = await createAtendimento('conv-minhas-curadorias-ui');
    await persistirAvaliacaoIa(atendimentoId);

    const curador = await login(request, 'curador');
    const detalhe = await request.get(`${apiUrl}/curadoria/${atendimentoId}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });
    const d = (await detalhe.json()) as { avaliacaoIa: { id: string; checklist: Array<{ chave: string; estado: string }> } };
    await request.post(`${apiUrl}/curadoria/${atendimentoId}/avaliacoes`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: {
        checklist: d.avaliacaoIa.checklist.map((c) => ({ chave: c.chave, estado: c.estado })),
        notaAvaliacaoIa: 9,
        falhasIdentificadas: [],
        resumoAtendimento: 'Minha conferencia UI'
      }
    });

    await loginUi(page, 'curador');
    await page.getByRole('link', { name: 'Minhas Curadorias' }).click();
    await expect(page).toHaveURL('/minhas-curadorias');
    await expect(page.getByRole('heading', { name: 'Minhas Curadorias' })).toBeVisible();
    await expect(page.getByText('Histórico de atendimentos conferidos por você.')).toBeVisible();

    const linkConv = page.getByRole('link', { name: 'conv-minhas-curadorias-ui' });
    await expect(linkConv).toBeVisible();
    await linkConv.click();

    await expect(page).toHaveURL(new RegExp(`/curadoria/${atendimentoId}`));
    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    const backLink = page.getByRole('link', { name: 'Voltar a Minhas Curadorias' });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL('/minhas-curadorias');
  });

  test('Gestao acessa Curadorias Realizadas na Casca e pode filtrar por curador', async ({
    page,
    request
  }) => {
    const atId = await createAtendimento('conv-curadorias-realizadas-gestao');
    await persistirAvaliacaoIa(atId);

    const curador = await login(request, 'curador');
    const detalhe = await request.get(`${apiUrl}/curadoria/${atId}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });
    const d = (await detalhe.json()) as { avaliacaoIa: { id: string; checklist: Array<{ chave: string; estado: string }> } };
    await request.post(`${apiUrl}/curadoria/${atId}/avaliacoes`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: {
        checklist: d.avaliacaoIa.checklist.map((c) => ({ chave: c.chave, estado: c.estado })),
        notaAvaliacaoIa: 8.5,
        falhasIdentificadas: [],
        resumoAtendimento: 'Realizada para Gestao'
      }
    });

    await loginUi(page, 'gestao');
    await page.getByRole('link', { name: 'Curadorias Realizadas' }).click();
    await expect(page).toHaveURL('/curadorias-realizadas');
    await expect(page.getByRole('heading', { name: 'Curadorias Realizadas' })).toBeVisible();
    await expect(page.getByText('Histórico de atendimentos conferidos pelos curadores.')).toBeVisible();

    // Filtro por curador está visível para gestão
    const curadorSelect = page.locator('#curadorias-realizadas-curador-filtro');
    await expect(curadorSelect).toBeVisible();
    await curadorSelect.selectOption({ label: 'Caio Curador' });
    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/curadorId=/);
    const card = page.locator('article.curadoria-row').filter({ hasText: 'conv-curadorias-realizadas-gestao' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Caio Curador')).toBeVisible();

    await card.getByRole('link', { name: 'Consultar' }).click();
    await expect(page.getByRole('heading', { name: 'Revisar Atendimento' })).toBeVisible();
    const backLink = page.getByRole('link', { name: 'Voltar a Curadorias Realizadas' });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(/\/curadorias-realizadas/);
  });

  test('Curadorias Realizadas filtra por Não informado e exibe o motivo formatado', async ({
    page,
    request
  }) => {
    const atNullId = await createAtendimento('conv-realizada-motivo-null', 'concluido');
    await queryDatabase(`
      update atendimentos set motivo_contato = null where id = $1
    `, [atNullId]);
    await persistirAvaliacaoIa(atNullId);

    const curador = await login(request, 'curador');
    const detalhe = await request.get(`${apiUrl}/curadoria/${atNullId}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });
    const d = (await detalhe.json()) as { avaliacaoIa: { id: string; checklist: Array<{ chave: string; estado: string }> } };
    await request.post(`${apiUrl}/curadoria/${atNullId}/avaliacoes`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: {
        checklist: d.avaliacaoIa.checklist.map((c) => ({ chave: c.chave, estado: c.estado })),
        notaAvaliacaoIa: 8.0,
        falhasIdentificadas: [],
        resumoAtendimento: 'Conferencia sem motivo'
      }
    });

    await loginUi(page, 'gestao');
    await page.goto('/curadorias-realizadas');

    const combobox = page.getByRole('combobox', { name: 'Motivo de Contato' });
    await combobox.fill('nao');
    await expect(page.getByRole('option', { name: 'Não informado' })).toBeVisible();
    await page.getByRole('option', { name: 'Não informado' }).click();
    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/[?&]motivo=N%C3%A3o(\+|%20)informado|motivo=Nao(\+|%20)informado/);
    const card = page.locator('article.curadoria-row').filter({ hasText: 'conv-realizada-motivo-null' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Não informado')).toBeVisible();
  });

  test('Curadorias Realizadas filtra combinando multiplos criterios do Curador com logica AND', async ({
    page,
    request
  }) => {
    const at1Id = await createAtendimento('conv-realizada-crit-1', 'concluido');
    const at2Id = await createAtendimento('conv-realizada-crit-2', 'concluido');
    await persistirAvaliacaoIa(at1Id);
    await persistirAvaliacaoIa(at2Id);

    const curador = await login(request, 'curador');
    const d1 = (await (await request.get(`${apiUrl}/curadoria/${at1Id}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    })).json()) as { avaliacaoIa: { checklist: Array<{ chave: string; estado: string }> } };

    await request.post(`${apiUrl}/curadoria/${at1Id}/avaliacoes`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: {
        checklist: d1.avaliacaoIa.checklist.map((c) => ({
          chave: c.chave,
          estado: c.chave === 'informou_protocolo_email' ? 'nao_atendido' : 'atendido'
        })),
        notaAvaliacaoIa: 7.5,
        falhasIdentificadas: ['informou_protocolo_email'],
        resumoAtendimento: 'Sem protocolo'
      }
    });

    const d2 = (await (await request.get(`${apiUrl}/curadoria/${at2Id}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    })).json()) as { avaliacaoIa: { checklist: Array<{ chave: string; estado: string }> } };

    await request.post(`${apiUrl}/curadoria/${at2Id}/avaliacoes`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: {
        checklist: d2.avaliacaoIa.checklist.map((c) => ({
          chave: c.chave,
          estado: 'atendido'
        })),
        notaAvaliacaoIa: 10.0,
        falhasIdentificadas: [],
        resumoAtendimento: 'Tudo atendido'
      }
    });

    await loginUi(page, 'gestao');
    await page.goto('/curadorias-realizadas');

    const triggerNaoAtendidos = page.locator('#curadorias-criterios-nao-atendidos-filtro');
    await triggerNaoAtendidos.click();
    await page.locator('label.criterios-multiselect-option').filter({ hasText: 'Informação de Protocolo' }).click();
    await triggerNaoAtendidos.click();

    const triggerAtendidos = page.locator('#curadorias-criterios-atendidos-filtro');
    await triggerAtendidos.click();
    await page.locator('label.criterios-multiselect-option').filter({ hasText: 'Saudação e Intenção' }).click();
    await triggerAtendidos.click();

    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/criteriosNaoAtendidos=/);
    await expect(page).toHaveURL(/criteriosAtendidos=/);

    await expect(page.locator('article.curadoria-row').filter({ hasText: 'conv-realizada-crit-1' })).toBeVisible();
    await expect(page.locator('article.curadoria-row').filter({ hasText: 'conv-realizada-crit-2' })).toHaveCount(0);

    // Limpa filtros
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL('/curadorias-realizadas');
    await expect(page.locator('article.curadoria-row').filter({ hasText: 'conv-realizada-crit-1' })).toBeVisible();
    await expect(page.locator('article.curadoria-row').filter({ hasText: 'conv-realizada-crit-2' })).toBeVisible();
  });

  test('filtra Fila de Curadoria e Curadorias Realizadas por ID da conversa via API e UI', async ({
    request,
    page
  }) => {
    const curador = await login(request, 'curador');
    const gestao = await login(request, 'gestao');

    const convPendente1 = `conv-fila-target-${Date.now()}`;
    const convPendente2 = `conv-fila-other-${Date.now()}`;
    const at1Id = await createAtendimento(convPendente1, 'concluido');
    const at2Id = await createAtendimento(convPendente2, 'concluido');
    await persistirAvaliacaoIa(at1Id);
    await persistirAvaliacaoIa(at2Id);

    // 1. Fila de Curadoria via API
    const filaRes = await request.get(`${apiUrl}/curadoria?conversationId=target`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });
    expect(filaRes.status()).toBe(200);
    const filaData = (await filaRes.json()) as { items: Array<{ conversationId: string }> };
    expect(filaData.items.some((i) => i.conversationId === convPendente1)).toBe(true);
    expect(filaData.items.some((i) => i.conversationId === convPendente2)).toBe(false);

    // 2. Fila de Curadoria via UI
    await loginUi(page, 'curador');
    await page.goto('/curadoria');

    const filaInput = page.locator('#curadoria-conversation-id-filtro');
    await expect(filaInput).toBeVisible();
    await filaInput.fill('target');
    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/conversationId=target/);
    await expect(page.locator('article.curadoria-row').filter({ hasText: convPendente1 })).toBeVisible();
    await expect(page.locator('article.curadoria-row').filter({ hasText: convPendente2 })).toHaveCount(0);

    // Limpar filtros na Fila
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL('/curadoria');
    await expect(filaInput).toHaveValue('');

    // 3. Realizar conferência em at1 para aparecer em Curadorias Realizadas
    const detail = (await (await request.get(`${apiUrl}/curadoria/${at1Id}`, {
      headers: { authorization: `Bearer ${curador.token}` }
    })).json()) as { avaliacaoIa: { checklist: Array<{ chave: string; estado: string }> } };

    await request.post(`${apiUrl}/curadoria/${at1Id}/avaliacoes`, {
      headers: { authorization: `Bearer ${curador.token}` },
      data: {
        checklist: detail.avaliacaoIa.checklist.map((c) => ({
          chave: c.chave,
          estado: 'atendido'
        })),
        notaAvaliacaoIa: 9.0,
        falhasIdentificadas: [],
        resumoAtendimento: 'Conferido'
      }
    });

    // 4. Curadorias Realizadas via API
    const realRes = await request.get(`${apiUrl}/curadorias-realizadas?conversationId=target`, {
      headers: { authorization: `Bearer ${gestao.token}` }
    });
    expect(realRes.status()).toBe(200);
    const realData = (await realRes.json()) as { items: Array<{ conversationId: string }> };
    expect(realData.items.some((i) => i.conversationId === convPendente1)).toBe(true);

    // 5. Curadorias Realizadas via UI
    await page.evaluate(() => window.sessionStorage.clear());
    await loginUi(page, 'gestao');
    await page.goto('/curadorias-realizadas');

    const realInput = page.locator('#curadorias-realizadas-conversation-id-filtro');
    await expect(realInput).toBeVisible();
    await realInput.fill('target');
    await page.getByRole('button', { name: 'Filtrar' }).click();

    await expect(page).toHaveURL(/conversationId=target/);
    await expect(page.locator('article.curadoria-row').filter({ hasText: convPendente1 })).toBeVisible();

    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page).toHaveURL('/curadorias-realizadas');
    await expect(realInput).toHaveValue('');
  });
});

