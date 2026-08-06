-- TME (tempo até primeira fala do Agente de Voz) e contadores de
-- execuções de tools para Taxa de Promessas Cumpridas no Dashboard.

alter table atendimentos
  add column tme_segundos integer,
  add column tools_executados integer not null default 0,
  add column tools_sucesso integer not null default 0;

alter table atendimentos
  add constraint atendimentos_tme_segundos_check
    check (tme_segundos is null or tme_segundos >= 0),
  add constraint atendimentos_tools_executados_check
    check (tools_executados >= 0),
  add constraint atendimentos_tools_sucesso_check
    check (tools_sucesso >= 0 and tools_sucesso <= tools_executados);
