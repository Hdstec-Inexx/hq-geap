# Lista do Monitoramento ao Vivo filtra por status aberto na ElevenLabs

A lista do Monitoramento ao Vivo vem de `GET /v1/convai/conversations` com `exclude_statuses` = `done`, `failed`, `processing`, restando só `in-progress` e `initiated`. Não filtramos por “hoje” nem confiamos em status local `em_andamento` obsoleto.

A ElevenLabs às vezes mantém conversas já encerradas com status aberto (zombies). Por isso a lista ainda descarta itens que, na própria resposta da fonte, já carregam sinal de término (`termination_reason` ou `call_successful` = `success`/`failure`), itens cuja `call_duration_secs` congelou enquanto a idade (wall clock desde `start_time_unix_secs`) avançou além de uma folga curta, itens com início há mais de 24h (acima de qualquer duração plausível de Atendimento ao vivo) e conversation IDs que o HQ já persiste como `concluido`. A alternativa — janela por data civil — continua rejeitada: “ao vivo” é estado na fonte, não calendário.

## Consequences

Qualquer tela ou API de “ao vivo” deve aplicar o mesmo critério; reconciliar status locais com a ElevenLabs continua necessário (ADR-0007). A lista ao vivo não é um `WHERE started_at = hoje`.
