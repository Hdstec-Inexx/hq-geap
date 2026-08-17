# Dia civil dos filtros e períodos em America/Sao_Paulo

Os limites de dia nos filtros de Atendimentos, Fila de Curadoria e períodos de dashboard seguem o dia civil de **America/Sao_Paulo**, não o timezone da sessão do banco nem do servidor. Como `concluido_em` é `timestamptz` e os filtros usam casts `::date`, o resultado depende do `TimeZone` da sessão Postgres — que, sem configuração explícita, tende a UTC, deslocando a virada do dia em 3h. As consultas devem fixar o fuso (ex: `AT TIME ZONE 'America/Sao_Paulo'`) em vez de depender de configuração de ambiente. A convenção de filtrar Atendimentos por `concluido_em` é mantida: Atendimentos `em_andamento` não aparecem em filtros de dia.

## Consequences

Filtros de dia existentes (Detalhamento de Indicador) que usam `::date` sem fuso explícito precisam ser corrigidos para o mesmo padrão, sob pena de divergência entre telas.
