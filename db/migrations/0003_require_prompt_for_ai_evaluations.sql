alter table avaliacoes
  add constraint avaliacoes_ia_exigem_prompt
  check (autor <> 'ia' or prompt_id is not null);
