# Avaliação executada e persistida pelo n8n

A chamada ao LLM da IA Avaliadora (via OpenRouter) e a persistência do seu resultado são responsabilidades exclusivas do workflow do n8n no MVP. O prompt, provedor, modelo e temperatura vivem versionados no PostgreSQL, editáveis pelo Admin no HQ; o n8n lê a versão ativa e grava a Avaliação diretamente no mesmo banco. O HQ não chama o LLM nem recebe um comando para persistir a Avaliação: apenas consulta os snapshots já gravados e deriva sua Aprovação. Se essa responsabilidade migrar para o HQ no futuro, esta decisão deverá ser substituída por novo ADR.

## Consequences

Cada Avaliação da IA registra qual versão de prompt a produziu. A escrita direta usa uma operação transacional do PostgreSQL para validar a Régua, recalcular a nota e persistir Avaliação e checks sem estados parciais. As chaves da ElevenLabs e do OpenRouter e a credencial de escrita no banco ficam no cofre de Credentials do n8n, nunca no `.env` do HQ. Indisponibilidade do banco interrompe a avaliação automática; o HQ continua sem responsabilidade de execução ou retentativa do LLM.
