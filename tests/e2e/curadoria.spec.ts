import { expect, test, type APIRequestContext } from '@playwright/test';
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

async function persistirAvaliacaoIa(atendimentoId: string) {
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
    aprovada.nota_qualidade
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
        encerramento_geap, atendimento_aprovado, nota_qualidade
      )
      select $1, 'ia', id, 10,
        true, true, true, true, true, true, true, true, 10
      from prompts_ia_avaliadora where ativo
    `, [emAndamentoId]);

    const curador = await login(request, 'curador');
    const response = await request.get(`${apiUrl}/curadoria`, {
      headers: { authorization: `Bearer ${curador.token}` }
    });

    expect(response.status()).toBe(200);
    const ids = ((await response.json()) as Array<{ id: string }>).map(({ id }) => id);
    expect(ids).toContain(pendenteId);
    expect(ids).not.toContain(semIaId);
    expect(ids).not.toContain(emAndamentoId);
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
    const filaIds = ((await fila.json()) as Array<{ id: string }>).map(({ id }) => id);
    expect(filaIds).not.toContain(atendimentoId);

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
          encerramento_geap, atendimento_aprovado, nota_qualidade
        )
        select $1, 'ia', id, 10,
          true, true, true, true, true, true, true, true, 10
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
  });

  test('Curador confere o checklist da IA pela interface e consulta o historico', async ({
    page
  }) => {
    const atendimentoId = await createAtendimento('conv-curadoria-interface');
    await persistirAvaliacaoIa(atendimentoId);

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('curador@hq.test');
    await page.getByLabel('Senha').fill('senha-curador');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/curadoria');

    await expect(page.getByRole('heading', { name: 'Fila de Curadoria' })).toBeVisible();
    await page.getByRole('link', { name: /conv-curadoria-interface/ }).click();
    await expect(page.getByRole('heading', { name: 'Conferência humana' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Avaliação original' }).locator('..').getByText('Atendimento objetivo.')
    ).toBeVisible();
    await expect(page.getByText('Ola')).toBeVisible();

    const protocolo = page.getByRole('group', { name: /Informação de Protocolo/ });
    await protocolo.getByLabel('Não atendido').check();
    await expect(page.getByText('Reprovado', { exact: true })).toBeVisible();
    await page.getByLabel('Nota da Avaliação da IA').fill('3');
    await page.getByLabel('Comentário da revisão (opcional)').fill('Corrigir protocolo.');
    await page.getByRole('button', { name: 'Salvar conferência' }).click();

    // onSaved remounts the form (flash "Conferência salva" is ephemeral).
    await expect(page.getByRole('heading', { name: 'Revisão mais recente' })).toBeVisible();
    await expect(page.getByText('Caio Curador')).toBeVisible();
    await expect(page.getByText('1 revisão')).toBeVisible();
    const revisaoRecente = page
      .locator('.review-history article')
      .filter({ hasText: 'Caio Curador' });
    await expect(revisaoRecente.getByText('Nota da Avaliação da IA:')).toBeVisible();
    await expect(revisaoRecente.getByText('3', { exact: true })).toBeVisible();
    await expect(revisaoRecente.getByText('Corrigir protocolo.')).toBeVisible();
    await expect(revisaoRecente.getByText('Não atendido').first()).toBeVisible();

    await protocolo.getByLabel('Atendido', { exact: true }).check();
    await page.getByLabel('Nota da Avaliação da IA').fill('8');
    await page.getByLabel('Comentário da revisão (opcional)').fill('');
    await page.getByRole('button', { name: 'Salvar conferência' }).click();
    await expect(page.getByText('2 revisões')).toBeVisible();

    await page.getByText('Consultar revisões anteriores').click();
    const anterior = page.locator('.review-history details li').first();
    await expect(anterior).toContainText('Informação de Protocolo');
    await expect(anterior).toContainText('Não atendido');
  });
});
