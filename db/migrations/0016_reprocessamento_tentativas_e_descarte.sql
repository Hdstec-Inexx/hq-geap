-- Rastreamento de tentativas e descarte de reprocessamento de transcrições
-- ADR-0016: Reprocessamento automático de transcrições inconsistentes e recálculo de Tempo de Espera

alter table atendimentos
  add column reprocessamento_tentativas smallint not null default 0,
  add column reprocessamento_ignorado boolean not null default false,
  add column reprocessamento_ultimo_erro text default null;

alter table atendimentos
  add constraint atendimentos_reprocessamento_tentativas_check
    check (reprocessamento_tentativas >= 0);

create index idx_atendimentos_reprocessamento_pendente
  on atendimentos(concluido_em asc)
  where status = 'concluido'
    and not reprocessamento_ignorado
    and reprocessamento_tentativas < 3
    and concluido_em < '2026-08-19';
