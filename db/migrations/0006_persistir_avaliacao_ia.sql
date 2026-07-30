alter table avaliacao_criterios
  add column criterio_chave text,
  add column criterio_nome text,
  add column criterio_critico boolean,
  add column criterio_ordem smallint;

update avaliacao_criterios ac
set criterio_chave = c.chave,
    criterio_nome = c.nome,
    criterio_critico = c.critico,
    criterio_ordem = c.ordem
from criterios c
where c.id = ac.criterio_id;

alter table avaliacao_criterios
  alter column criterio_chave set not null,
  alter column criterio_nome set not null,
  alter column criterio_critico set not null,
  alter column criterio_ordem set not null;

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

  return query select v_avaliacao_id, v_nota;
end;
$$;
