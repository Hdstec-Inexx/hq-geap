# Dia civil dos filtros e períodos em America/Sao_Paulo

Os limites de dia nos filtros de Atendimentos, Fila de Curadoria e períodos de dashboard seguem o dia civil de **America/Sao_Paulo**, não o timezone da sessão do banco nem do servidor. Como `concluido_em` é `timestamptz` e os filtros usam casts `::date`, o resultado depende do `TimeZone` da sessão Postgres — que, sem configuração explícita, tende a UTC, deslocando a virada do dia em 3h. As consultas devem fixar o fuso (ex: `AT TIME ZONE 'America/Sao_Paulo'`) em vez de depender de configuração de ambiente.

Com **Data inicial/final** informadas, a convenção de filtrar Atendimentos **do HQ** por `concluido_em` permanece: Atendimentos `em_andamento` não entram nesse recorte de dia. Sem período na **Listagem de Atendimentos**, o servidor aplica o mês civil corrente: `em_andamento` entra por `iniciado_em`/`criado_em` nesse mês; `concluido` por `concluido_em`. A Fila de Curadoria sem período também observa o mês corrente, só por `concluido_em` (não há `em_andamento` na fila). O Detalhamento do Indicador continua exigindo o período do dashboard e não herda o mês implícito.

O Total de Atendimentos do Pulso na ElevenLabs usa as **mesmas datas civis** `inicio`/`fim` convertidas a unix (início do dia `inicio` até início do dia seguinte a `fim`) sobre o horário de início da conversa na fonte — não sobre `concluido_em`.

## Consequences

Filtros de dia existentes (Detalhamento de Indicador) que usam `::date` sem fuso explícito precisam ser corrigidos para o mesmo padrão, sob pena de divergência entre telas. A Listagem de Atendimentos sem datas e o filtro explícito de dia não compartilham a mesma regra para `em_andamento` — não tratar as duas como o mesmo recorte. KPIs do Pulso que leem o HQ (taxa, SLA, gráficos) compartilham o recorte civil de `concluido_em`; o card Total pode divergir em quantidade porque conta a ElevenLabs por início de conversa.
