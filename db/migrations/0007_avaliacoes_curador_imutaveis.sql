alter table avaliacoes
  drop constraint avaliacoes_atendimento_id_autor_key;

alter table avaliacoes
  add column autor_usuario_nome text;

update avaliacoes a
set autor_usuario_nome = u.nome
from usuarios u
where a.autor = 'curador' and u.id = a.autor_usuario_id;

alter table avaliacoes
  add constraint avaliacoes_curador_autor_snapshot_check
  check ((autor = 'curador') = (autor_usuario_nome is not null));

alter table avaliacao_criterios
  add column criterio_condicional boolean;

update avaliacao_criterios ac
set criterio_condicional = c.condicional
from criterios c
where c.id = ac.criterio_id;

alter table avaliacao_criterios
  alter column criterio_condicional set not null;

create function preencher_criterio_condicional_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.criterio_condicional is null then
    select condicional
      into new.criterio_condicional
    from criterios
    where id = new.criterio_id;
  end if;
  return new;
end;
$$;

create trigger avaliacao_criterios_snapshot_condicional
before insert on avaliacao_criterios
for each row execute function preencher_criterio_condicional_snapshot();

create unique index idx_avaliacoes_ia_unica
  on avaliacoes(atendimento_id)
  where autor = 'ia';

create index idx_avaliacoes_curador_recentes
  on avaliacoes(atendimento_id, criado_em desc, id desc)
  where autor = 'curador';

create function impedir_mutacao_avaliacao()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Avaliacao imutavel: crie uma nova revisao';
end;
$$;

create trigger avaliacoes_sao_imutaveis
before update or delete on avaliacoes
for each row execute function impedir_mutacao_avaliacao();

create trigger avaliacao_criterios_sao_imutaveis
before update or delete on avaliacao_criterios
for each row execute function impedir_mutacao_avaliacao();

create or replace view fila_curadoria as
select a.*
from atendimentos a
join avaliacoes av_ia
  on av_ia.atendimento_id = a.id and av_ia.autor = 'ia'
where a.status = 'concluido'
  and not exists (
    select 1
    from avaliacoes av_cur
    where av_cur.atendimento_id = a.id and av_cur.autor = 'curador'
  );

create view avaliacoes_curador_mais_recentes as
select distinct on (atendimento_id) *
from avaliacoes
where autor = 'curador'
order by atendimento_id, criado_em desc, id desc;
