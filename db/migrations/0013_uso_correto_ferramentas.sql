-- Critério Uso Correto de Ferramentas (valor 0) + gate ADR-0011:
-- ferramentas false ⇒ resolução false (perde 3,0).

insert into criterios (chave, nome, descricao, valor, critico, condicional, ativo, ordem)
values (
  'uso_correto_ferramentas',
  'Uso Correto de Ferramentas',
  'Acionou as ferramentas corretas (boleto, rede credenciada, IRPF, transferência etc.) sem uso indevido ou falha operacional? Se não atendido, Resolução da Solicitação também fica não atendida.',
  0,
  false,
  false,
  true,
  8
)
on conflict (chave) do nothing;

alter table avaliacoes
  add column uso_correto_ferramentas boolean;

alter table avaliacoes
  drop constraint if exists avaliacoes_ia_contrato_tipado_check;

-- Avaliações da IA já persistidas: grandfather como atendido (valor 0 não altera a nota).
-- Backfill ANTES do novo CHECK (espelha o padrão da 0010).
alter table avaliacoes disable trigger avaliacoes_sao_imutaveis;
alter table avaliacao_criterios disable trigger avaliacao_criterios_sao_imutaveis;
alter table avaliacao_curador_criterios disable trigger avaliacao_curador_criterios_sao_imutaveis;

update avaliacoes
set uso_correto_ferramentas = true
where autor = 'ia' and uso_correto_ferramentas is null;

insert into avaliacao_criterios (
  avaliacao_id,
  criterio_id,
  criterio_chave,
  criterio_nome,
  criterio_critico,
  criterio_condicional,
  criterio_ordem,
  estado,
  valor_criterio
)
select
  a.id,
  c.id,
  c.chave,
  c.nome,
  c.critico,
  c.condicional,
  c.ordem,
  'atendido'::estado_criterio,
  c.valor
from avaliacoes a
cross join criterios c
where a.autor = 'ia'
  and c.chave = 'uso_correto_ferramentas'
  and not exists (
    select 1
    from avaliacao_criterios ac
    where ac.avaliacao_id = a.id and ac.criterio_id = c.id
  );

insert into avaliacao_curador_criterios (
  avaliacao_curador_id,
  criterio_id,
  criterio_chave,
  criterio_nome,
  criterio_critico,
  criterio_condicional,
  criterio_ordem,
  estado,
  valor_criterio
)
select
  acur.id,
  c.id,
  c.chave,
  c.nome,
  c.critico,
  c.condicional,
  c.ordem,
  'atendido'::estado_criterio,
  c.valor
from avaliacoes_curador acur
cross join criterios c
where c.chave = 'uso_correto_ferramentas'
  and not exists (
    select 1
    from avaliacao_curador_criterios acc
    where acc.avaliacao_curador_id = acur.id and acc.criterio_id = c.id
  );

alter table avaliacao_curador_criterios enable trigger avaliacao_curador_criterios_sao_imutaveis;
alter table avaliacao_criterios enable trigger avaliacao_criterios_sao_imutaveis;
alter table avaliacoes enable trigger avaliacoes_sao_imutaveis;

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
      and uso_correto_ferramentas is not null
      and atendimento_aprovado is not null
      and nota_qualidade is not null
    )
  );

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
  v_checklist jsonb;
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

  -- ADR-0011: ferramentas false ⇒ resolução false (perde 3,0).
  v_checklist := p_checklist;
  if (v_checklist->>'uso_correto_ferramentas')::boolean is false then
    v_checklist := jsonb_set(v_checklist, '{resolveu_solicitacao}', 'false'::jsonb);
  end if;

  select coalesce(sum(c.valor) filter (
    where (item.valor)::boolean
  ), 0)
    into v_nota
  from jsonb_each(v_checklist) as item(chave, valor)
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
    uso_correto_ferramentas,
    atendimento_aprovado,
    nota_qualidade
  ) values (
    p_atendimento_id,
    'ia',
    p_prompt_id,
    v_nota,
    coalesce(p_falhas_identificadas, '[]'::jsonb),
    nullif(trim(p_resumo_atendimento), ''),
    (v_checklist->>'saudacao_e_intencao')::boolean,
    (v_checklist->>'solicitou_cpf')::boolean,
    (v_checklist->>'informou_protocolo_email')::boolean,
    (v_checklist->>'resolveu_solicitacao')::boolean,
    (v_checklist->>'validou_email_por_extenso')::boolean,
    (v_checklist->>'sem_diminutivos')::boolean,
    (v_checklist->>'encerramento_geap')::boolean,
    (v_checklist->>'uso_correto_ferramentas')::boolean,
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
  from jsonb_each(v_checklist) as item(chave, valor)
  join criterios c on c.chave = item.chave and c.ativo;

  delete from avaliacoes_ia_execucoes where atendimento_id = p_atendimento_id;
  return query select v_avaliacao_id, v_nota;
end;
$$;
