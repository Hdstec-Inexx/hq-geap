-- Avaliação da IA tipada (contrato LLM): colunas booleanas ×7 +
-- atendimento_aprovado e nota_qualidade (claims da LLM).
-- Nota canônica permanece a soma da Régua; Aprovação canônica continua
-- derivada (nota >= 7.0 e sem Falha Crítica). Booleans mapeiam para
-- avaliacao_criterios: true → atendido, false → nao_atendido.

alter table avaliacoes
  add column saudacao_e_intencao boolean,
  add column solicitou_cpf boolean,
  add column informou_protocolo_email boolean,
  add column resolveu_solicitacao boolean,
  add column validou_email_por_extenso boolean,
  add column sem_diminutivos boolean,
  add column encerramento_geap boolean,
  add column atendimento_aprovado boolean,
  add column nota_qualidade numeric(4, 2);

-- Backfill de Avaliações da IA existentes a partir do snapshot de critérios.
update avaliacoes a
set
  saudacao_e_intencao = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'saudacao_e_intencao'
  ),
  solicitou_cpf = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'solicitou_cpf'
  ),
  informou_protocolo_email = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'informou_protocolo_email'
  ),
  resolveu_solicitacao = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'resolveu_solicitacao'
  ),
  validou_email_por_extenso = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'validou_email_por_extenso'
  ),
  sem_diminutivos = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'sem_diminutivos'
  ),
  encerramento_geap = (
    select ac.estado in ('atendido', 'nao_se_aplica')
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_chave = 'encerramento_geap'
  ),
  nota_qualidade = a.nota,
  atendimento_aprovado = (
    a.nota >= 7.0
    and not exists (
      select 1
      from avaliacao_criterios ac
      where ac.avaliacao_id = a.id
        and ac.criterio_critico
        and ac.estado = 'nao_atendido'
    )
  )
where a.autor = 'ia';

alter table avaliacoes
  add constraint avaliacoes_ia_contrato_tipado_check
  check (
    (autor = 'ia') = (
      saudacao_e_intencao is not null
      and solicitou_cpf is not null
      and informou_protocolo_email is not null
      and resolveu_solicitacao is not null
      and validou_email_por_extenso is not null
      and sem_diminutivos is not null
      and encerramento_geap is not null
      and atendimento_aprovado is not null
      and nota_qualidade is not null
    )
  );

-- Unicidade da Avaliação da IA por Atendimento (já criada em 0007; reforço idempotente).
create unique index if not exists idx_avaliacoes_ia_unica
  on avaliacoes(atendimento_id)
  where autor = 'ia';

create or replace function reivindicar_avaliacoes_ia(p_limite integer default 20)
returns table (
  atendimento_id uuid,
  transcricao jsonb,
  prompt_id uuid,
  prompt_versao integer,
  prompt text,
  provedor text,
  modelo text,
  temperatura numeric,
  criterio_chaves text[],
  checklist_schema jsonb,
  contrato_criterios text,
  lease_ate timestamptz
)
language sql
as $$
  with configuracao as materialized (
    select id, versao, prompt, provedor, modelo, temperatura
    from prompts_ia_avaliadora
    where ativo
  ),
  candidatos as (
    select a.id
    from atendimentos a
    cross join configuracao
    left join avaliacoes_ia_execucoes e on e.atendimento_id = a.id
    where a.status = 'concluido'
      and (e.atendimento_id is null or e.lease_ate <= now())
      and not exists (
        select 1 from avaliacoes av
        where av.atendimento_id = a.id and av.autor = 'ia'
      )
    order by a.concluido_em, a.id
    for update of a skip locked
    limit least(greatest(p_limite, 1), 100)
  ),
  reivindicados as (
    insert into avaliacoes_ia_execucoes (atendimento_id, lease_ate)
    select id, now() + interval '10 minutes'
    from candidatos
    on conflict (atendimento_id) do update
      set lease_ate = excluded.lease_ate
      where avaliacoes_ia_execucoes.lease_ate <= now()
    returning atendimento_id, lease_ate
  ),
  regua as (
    select
      array_agg(chave order by ordem) as criterio_chaves,
      jsonb_object_agg(
        chave,
        jsonb_build_object('type', 'boolean')
      ) as checklist_schema,
      string_agg(
        format('- %s (%s): %s', chave, nome, coalesce(descricao, '')),
        E'\n' order by ordem
      ) as contrato_criterios
    from criterios
    where ativo
  )
  select
    a.id,
    a.transcricao,
    p.id,
    p.versao,
    p.prompt,
    p.provedor,
    p.modelo,
    p.temperatura,
    r.criterio_chaves,
    r.checklist_schema,
    r.contrato_criterios,
    claimed.lease_ate
  from reivindicados claimed
  join atendimentos a on a.id = claimed.atendimento_id
  cross join configuracao p
  cross join regua r;
$$;

drop function if exists persistir_avaliacao_ia(uuid, uuid, jsonb, jsonb, text);

create or replace function persistir_avaliacao_ia(
  p_atendimento_id uuid,
  p_prompt_id uuid,
  p_checklist jsonb,
  p_falhas_identificadas jsonb,
  p_resumo_atendimento text,
  p_atendimento_aprovado boolean,
  p_nota_qualidade numeric
)
returns table (avaliacao_id uuid, nota numeric)
language plpgsql
as $$
declare
  v_avaliacao_id uuid;
  v_nota numeric(4, 2);
  v_criterios_ativos integer;
  v_total_regua numeric(4, 2);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_atendimento_id::text, 0));

  select a.id, a.nota
    into v_avaliacao_id, v_nota
  from avaliacoes a
  where a.atendimento_id = p_atendimento_id and a.autor = 'ia';

  if found then
    delete from avaliacoes_ia_execucoes where atendimento_id = p_atendimento_id;
    return query select v_avaliacao_id, v_nota;
    return;
  end if;

  if not exists (
    select 1 from atendimentos
    where id = p_atendimento_id and status = 'concluido'
  ) then
    raise exception 'Atendimento must exist and be completed' using errcode = '22023';
  end if;

  if not exists (select 1 from prompts_ia_avaliadora where id = p_prompt_id) then
    raise exception 'AI prompt version does not exist' using errcode = '22023';
  end if;

  if p_atendimento_aprovado is null then
    raise exception 'atendimento_aprovado is required' using errcode = '22023';
  end if;

  if p_nota_qualidade is null
    or p_nota_qualidade < 0
    or p_nota_qualidade > 10
  then
    raise exception 'nota_qualidade must be between 0 and 10' using errcode = '22023';
  end if;

  if jsonb_typeof(p_checklist) is distinct from 'object' then
    raise exception 'Checklist must be a JSON object' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_falhas_identificadas, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Identified failures must be a JSON array' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(valor), 0)
    into v_criterios_ativos, v_total_regua
  from criterios
  where ativo;

  if v_total_regua <> 10 then
    raise exception 'Active evaluation criteria must total 10 points' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_object_keys(p_checklist)) <> v_criterios_ativos
    or exists (
      select 1
      from jsonb_object_keys(p_checklist) as item(chave)
      left join criterios c on c.chave = item.chave and c.ativo
      where c.id is null
    )
  then
    raise exception 'Checklist must contain every active criterion exactly once' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(p_checklist) as item(chave, valor)
    where jsonb_typeof(item.valor) is distinct from 'boolean'
  ) then
    raise exception 'Checklist values must be boolean' using errcode = '22023';
  end if;

  select coalesce(sum(c.valor) filter (
    where (item.valor)::boolean
  ), 0)
    into v_nota
  from jsonb_each(p_checklist) as item(chave, valor)
  join criterios c on c.chave = item.chave and c.ativo;

  insert into avaliacoes (
    atendimento_id,
    autor,
    prompt_id,
    nota,
    falhas_identificadas,
    resumo_atendimento,
    saudacao_e_intencao,
    solicitou_cpf,
    informou_protocolo_email,
    resolveu_solicitacao,
    validou_email_por_extenso,
    sem_diminutivos,
    encerramento_geap,
    atendimento_aprovado,
    nota_qualidade
  ) values (
    p_atendimento_id,
    'ia',
    p_prompt_id,
    v_nota,
    coalesce(p_falhas_identificadas, '[]'::jsonb),
    nullif(trim(p_resumo_atendimento), ''),
    (p_checklist->>'saudacao_e_intencao')::boolean,
    (p_checklist->>'solicitou_cpf')::boolean,
    (p_checklist->>'informou_protocolo_email')::boolean,
    (p_checklist->>'resolveu_solicitacao')::boolean,
    (p_checklist->>'validou_email_por_extenso')::boolean,
    (p_checklist->>'sem_diminutivos')::boolean,
    (p_checklist->>'encerramento_geap')::boolean,
    p_atendimento_aprovado,
    p_nota_qualidade
  )
  returning id into v_avaliacao_id;

  insert into avaliacao_criterios (
    avaliacao_id,
    criterio_id,
    criterio_chave,
    criterio_nome,
    criterio_critico,
    criterio_ordem,
    estado,
    valor_criterio
  )
  select
    v_avaliacao_id,
    c.id,
    c.chave,
    c.nome,
    c.critico,
    c.ordem,
    case when (item.valor)::boolean
      then 'atendido'::estado_criterio
      else 'nao_atendido'::estado_criterio
    end,
    c.valor
  from jsonb_each(p_checklist) as item(chave, valor)
  join criterios c on c.chave = item.chave and c.ativo;

  delete from avaliacoes_ia_execucoes where atendimento_id = p_atendimento_id;
  return query select v_avaliacao_id, v_nota;
end;
$$;
