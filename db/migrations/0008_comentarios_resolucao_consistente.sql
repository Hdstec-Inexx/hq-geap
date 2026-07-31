alter table comentarios
  drop constraint comentarios_check,
  add constraint comentarios_resolucao_consistente check (
    (status = 'resolvido') =
    (resolvido_em is not null and resolvido_por is not null)
  );

create index idx_comentarios_status_criado_em
  on comentarios(status, criado_em);
