# Lista do Monitoramento ao Vivo filtra por status aberto na ElevenLabs

A lista do Monitoramento ao Vivo cruza duas leituras de `GET /v1/convai/conversations`: (1) com `exclude_statuses` = `done`, `failed`, `processing` (candidatas `in-progress` / `initiated`) e (2) a listagem geral sem esse filtro, paginada até resolver as candidatas ou esgotar o catálogo. Só entram IDs presentes nas duas (match exato de `conversation_id`, não prefixo). Não filtramos por “hoje” nem confiamos em status local `em_andamento` obsoleto.

A ElevenLabs às vezes mantém conversas já encerradas com status aberto (zombies) e o filtro `exclude_statuses` pode devolver IDs que ainda aceitam o WebSocket de monitor (`history_complete`) mas **não** aparecem na listagem geral. Por isso a lista ainda descarta itens fora do catálogo geral, itens com sinal de término (`termination_reason` ou `call_successful` = `success`/`failure`), itens cuja `call_duration_secs` congelou enquanto a idade (wall clock desde `start_time_unix_secs`) avançou além de uma folga curta, itens com início há mais de 24h e conversation IDs que o HQ já persiste como `concluido`. A alternativa — janela por data civil — continua rejeitada: “ao vivo” é estado na fonte, não calendário.

## Consequences

Qualquer tela ou API de “ao vivo” deve aplicar o mesmo critério; reconciliar status locais com a ElevenLabs continua necessário (ADR-0007). A lista ao vivo não é um `WHERE started_at = hoje`.
