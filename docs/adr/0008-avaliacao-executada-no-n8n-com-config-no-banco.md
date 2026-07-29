# Execução da avaliação no n8n com configuração persistida no banco

A chamada ao LLM da IA Avaliadora (via OpenRouter) é executada pelo workflow do n8n — não pela nossa API —, mas o prompt, provedor, modelo e temperatura vivem versionados numa tabela do nosso banco, editáveis pelo Admin na UI. O workflow busca a versão ativa da configuração antes de avaliar. Isso preserva o ADR-0006 (o sistema configura a régua) sem exigir a reescrita imediata do fluxo n8n já existente, que ainda passará por ajustes. Se um dia a avaliação migrar para dentro da API, a configuração já está onde deve estar — só muda o executor.

## Consequences

Cada avaliação da IA registra qual versão de prompt a produziu (sem isso, a Concordância perde o recorte "por versão de prompt" e não dá para saber se uma mudança de prompt melhorou a calibração). O n8n passa a depender do nosso banco para rodar — indisponibilidade do banco interrompe também a avaliação automática.
