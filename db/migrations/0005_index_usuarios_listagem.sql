create index usuarios_listagem_idx
  on usuarios (ativo desc, lower(nome), id);
