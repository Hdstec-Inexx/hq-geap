-- Nao inventa um responsavel historico: itens incompletos voltam para a fila.
update comentarios
set
  status = 'pendente',
  resolvido_por = null,
  resolvido_em = null
where
  (status = 'resolvido' and (resolvido_por is null or resolvido_em is null))
  or
  (status = 'pendente' and (resolvido_por is not null or resolvido_em is not null));

alter table comentarios
  drop constraint comentarios_resolucao_consistente,
  add constraint comentarios_resolucao_consistente check (
    (
      status = 'resolvido'
      and resolvido_em is not null
      and resolvido_por is not null
    )
    or
    (
      status = 'pendente'
      and resolvido_em is null
      and resolvido_por is null
    )
  );

drop index idx_comentarios_status;
drop index idx_comentarios_status_criado_em;

create index idx_comentarios_status_criado_em
  on comentarios(status, criado_em, id);
