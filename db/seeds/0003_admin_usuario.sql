-- Admin inicial para ambientes vazios (Fase 0).
-- Só cria se ainda não houver Admin ativo. Senha padrão: senha-admin
insert into usuarios (nome, email, senha_hash, papel)
select
  'Administrador HQ',
  'admin@hq.local',
  crypt('senha-admin', gen_salt('bf')),
  'admin'
where not exists (
  select 1 from usuarios where papel = 'admin' and ativo
);
