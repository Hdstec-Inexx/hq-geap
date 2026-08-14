-- A ordenação por criado_em já é coberta pela migration 0004.
create index idx_atendimentos_concluido_id
  on atendimentos(concluido_em, id)
  where status = 'concluido';
