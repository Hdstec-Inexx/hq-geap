-- Avaliacao do Curador em aggregate separado (ADR-0009 / #33 / #38):
-- espelho da correcao (checklist via criterios + falhas/resumo),
-- Nota da Avaliacao da IA e comentario opcional. Sem coluna booleana
-- de alinhamento armazenada; a metrica de calibracao segue derivada.

create table avaliacoes_curador (
  id                   uuid primary key default gen_random_uuid(),
  atendimento_id       uuid not null references atendimentos(id),
  avaliacao_ia_id      uuid not null references avaliacoes(id),
  autor_usuario_id     uuid not null references usuarios(id),
  autor_usuario_nome   text not null,
  nota                 numeric(4, 2) not null,
  falhas_identificadas jsonb not null default '[]'::jsonb,
  resumo_atendimento   text,
  nota_avaliacao_ia    numeric(4, 2) not null
    check (nota_avaliacao_ia >= 0 and nota_avaliacao_ia <= 10),
  comentario           text,
  criado_em            timestamptz not null default now(),
  check (jsonb_typeof(falhas_identificadas) = 'array')
);

create index idx_avaliacoes_curador_atendimento_recentes
  on avaliacoes_curador(atendimento_id, criado_em desc, id desc);

create index idx_avaliacoes_curador_avaliacao_ia
  on avaliacoes_curador(avaliacao_ia_id);

create table avaliacao_curador_criterios (
  id                     uuid primary key default gen_random_uuid(),
  avaliacao_curador_id   uuid not null references avaliacoes_curador(id) on delete cascade,
  criterio_id            uuid not null references criterios(id),
  estado                 estado_criterio not null,
  valor_criterio         numeric(4, 2) not null,
  criterio_chave         text not null,
  criterio_nome          text not null,
  criterio_critico       boolean not null,
  criterio_condicional   boolean not null,
  criterio_ordem         smallint not null,
  unique (avaliacao_curador_id, criterio_id)
);

create index idx_avaliacao_curador_criterios_criterio
  on avaliacao_curador_criterios(criterio_id);

-- Migra revisoes historicas autor=curador para o aggregate novo (liga a IA do mesmo Atendimento).
alter table avaliacoes disable trigger avaliacoes_sao_imutaveis;
alter table avaliacao_criterios disable trigger avaliacao_criterios_sao_imutaveis;

with migradas as (
  insert into avaliacoes_curador (
    id,
    atendimento_id,
    avaliacao_ia_id,
    autor_usuario_id,
    autor_usuario_nome,
    nota,
    falhas_identificadas,
    resumo_atendimento,
    nota_avaliacao_ia,
    comentario,
    criado_em
  )
  select
    cur.id,
    cur.atendimento_id,
    ia.id,
    cur.autor_usuario_id,
    cur.autor_usuario_nome,
    cur.nota,
    coalesce(cur.falhas_identificadas, '[]'::jsonb),
    cur.resumo_atendimento,
    0,
    null,
    cur.criado_em
  from avaliacoes cur
  join avaliacoes ia
    on ia.atendimento_id = cur.atendimento_id and ia.autor = 'ia'
  where cur.autor = 'curador'
  returning id
)
insert into avaliacao_curador_criterios (
  id,
  avaliacao_curador_id,
  criterio_id,
  estado,
  valor_criterio,
  criterio_chave,
  criterio_nome,
  criterio_critico,
  criterio_condicional,
  criterio_ordem
)
select
  ac.id,
  ac.avaliacao_id,
  ac.criterio_id,
  ac.estado,
  ac.valor_criterio,
  ac.criterio_chave,
  ac.criterio_nome,
  ac.criterio_critico,
  ac.criterio_condicional,
  ac.criterio_ordem
from avaliacao_criterios ac
join migradas m on m.id = ac.avaliacao_id;

delete from avaliacao_criterios
where avaliacao_id in (
  select id from avaliacoes where autor = 'curador'
);

delete from avaliacoes where autor = 'curador';

alter table avaliacoes enable trigger avaliacoes_sao_imutaveis;
alter table avaliacao_criterios enable trigger avaliacao_criterios_sao_imutaveis;

alter table avaliacoes
  drop constraint if exists avaliacoes_curador_autor_snapshot_check;

alter table avaliacoes
  add constraint avaliacoes_somente_autor_ia check (autor = 'ia');

drop view if exists fila_curadoria;
create view fila_curadoria as
select a.*
from atendimentos a
join avaliacoes av_ia
  on av_ia.atendimento_id = a.id and av_ia.autor = 'ia'
where a.status = 'concluido'
  and not exists (
    select 1
    from avaliacoes_curador av_cur
    where av_cur.atendimento_id = a.id
  );

drop view if exists avaliacoes_curador_mais_recentes;
create view avaliacoes_curador_mais_recentes as
select distinct on (atendimento_id) *
from avaliacoes_curador
order by atendimento_id, criado_em desc, id desc;

create trigger avaliacoes_curador_sao_imutaveis
before update or delete on avaliacoes_curador
for each row execute function impedir_mutacao_avaliacao();

create trigger avaliacao_curador_criterios_sao_imutaveis
before update or delete on avaliacao_curador_criterios
for each row execute function impedir_mutacao_avaliacao();
