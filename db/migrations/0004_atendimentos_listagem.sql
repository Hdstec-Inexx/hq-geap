alter table atendimentos
  add column elevenlabs_event_timestamp bigint;

create index idx_atendimentos_criado_id
  on atendimentos (criado_em desc, id desc);
