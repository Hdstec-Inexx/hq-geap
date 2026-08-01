-- Marcador de invalidação de Sessão após Admin redefinir senha (issue #35 / #33).
alter table usuarios
  add column senha_versao integer not null default 0;

alter table usuarios
  add constraint usuarios_senha_versao_nao_negativa
  check (senha_versao >= 0);
