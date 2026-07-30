do $$
begin
  if exists (select 1 from avaliacao_criterios) then
    raise exception 'Cannot create trustworthy criterion snapshots from existing checks';
  end if;
end;
$$;

alter table avaliacao_criterios
  add column criterio_chave text not null,
  add column criterio_nome text not null,
  add column criterio_critico boolean not null,
  add column criterio_ordem smallint not null;

create table avaliacoes_ia_execucoes (
  atendimento_id uuid primary key references atendimentos(id) on delete cascade,
  lease_ate timestamptz not null,
  criado_em timestamptz not null default now()
);
create index idx_avaliacoes_ia_execucoes_lease
  on avaliacoes_ia_execucoes(lease_ate);

create function reivindicar_avaliacoes_ia(p_limite integer default 20)
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
        jsonb_build_object(
          'type', 'string',
          'enum', case
            when condicional then jsonb_build_array('atendido', 'nao_atendido', 'nao_se_aplica')
            else jsonb_build_array('atendido', 'nao_atendido')
          end
        )
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

create function persistir_avaliacao_ia(
  p_atendimento_id uuid,
  p_prompt_id uuid,
  p_checklist jsonb,
  p_falhas_identificadas jsonb,
  p_resumo_atendimento text
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
    select 1 from jsonb_each_text(p_checklist) as item(chave, estado)
    where item.estado not in ('atendido', 'nao_atendido', 'nao_se_aplica')
  ) then
    raise exception 'Checklist contains an invalid criterion state' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each_text(p_checklist) as item(chave, estado)
    join criterios c on c.chave = item.chave and c.ativo
    where item.estado = 'nao_se_aplica' and not c.condicional
  ) then
    raise exception 'Only conditional criteria can be not applicable' using errcode = '22023';
  end if;

  select coalesce(sum(c.valor) filter (
    where item.estado in ('atendido', 'nao_se_aplica')
  ), 0)
    into v_nota
  from jsonb_each_text(p_checklist) as item(chave, estado)
  join criterios c on c.chave = item.chave and c.ativo;

  insert into avaliacoes (
    atendimento_id,
    autor,
    prompt_id,
    nota,
    falhas_identificadas,
    resumo_atendimento
  ) values (
    p_atendimento_id,
    'ia',
    p_prompt_id,
    v_nota,
    coalesce(p_falhas_identificadas, '[]'::jsonb),
    nullif(trim(p_resumo_atendimento), '')
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
    item.estado::estado_criterio,
    c.valor
  from jsonb_each_text(p_checklist) as item(chave, estado)
  join criterios c on c.chave = item.chave and c.ativo;

  delete from avaliacoes_ia_execucoes where atendimento_id = p_atendimento_id;
  return query select v_avaliacao_id, v_nota;
end;
$$;
