# Dia civil America/Sao_Paulo fixado na filtragem de datas

A filtragem por dia ou período sobre `concluido_em` (Fila de Curadoria, listagem de Atendimentos, Detalhamento de Indicadores e Dashboards) fixa o fuso horário em `America/Sao_Paulo` diretamente nas consultas SQL utilizando `AT TIME ZONE 'America/Sao_Paulo'`.

A conversão explícita garante que a interpretação de "dia civil" (início e fim de dia) corresponda sempre ao horário de Brasília, independentemente do timezone configurado na sessão do PostgreSQL ou no servidor da aplicação. Atendimentos com status `em_andamento` não possuem data de conclusão e não entram em filtros de dia civil.
