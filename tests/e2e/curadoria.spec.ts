import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';
import aprovada from '../fixtures/avaliacoes/avaliacao-aprovada.json' with { type: 'json' };
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
  status: 'em_andamento' | 'concluido' = 'concluido'
) {
  const result = await queryDatabase<{ id: string }>(`
    insert into atendimentos (
      agente_voz_id, elevenlabs_conversation_id, status, transcricao,
      audio_url, houve_transferencia, concluido_em, duracao_segundos,
      motivo_contato
    )
    select id, $1, $2::status_atendimento,
      '[{"role":"agent","message":"Ola","time_in_call_secs":0}]'::jsonb,
      'atendimentos/teste.mp3', false,
      case when $2::text = 'concluido' then now() else null end,
      42, 'Rede credenciada'
    from agentes_voz
    where elevenlabs_agent_id = 'agent-livia-curadoria'
    returning id
  `, [conversationId, status]);
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
});
