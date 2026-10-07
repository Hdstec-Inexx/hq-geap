-- Tabela de favoritos por perfil e atendimento
-- Issue #252: Favoritar e desfavoritar no detalhe do Atendimento e no Monitoramento ao Vivo

create table favoritos (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references usuarios(id) on delete cascade,
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  favoritado_em  timestamptz not null default now(),
  constraint uq_favoritos_perfil_atendimento unique (perfil_id, atendimento_id)
);

create index idx_favoritos_atendimento_id on favoritos(atendimento_id);
create index idx_favoritos_perfil_id on favoritos(perfil_id);
