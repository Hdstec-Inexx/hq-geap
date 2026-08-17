# Credentials dos workflows n8n

O workflow de avaliação é implantado e mantido no n8n, fora deste repositório. Antes de ativá-lo, configure no cofre de **Credentials** da instância:

| Nome recomendado | Tipo no n8n | Uso |
| --- | --- | --- |
| `HQ GEAP PostgreSQL` | Postgres | Ler a configuração ativa e persistir a Avaliação e seus checks |
| `HQ GEAP OpenRouter` | Header Auth | Enviar `Authorization: Bearer <token>` nas chamadas ao OpenRouter |
| `HQ Ingestion API Key` | Header Auth | Enviar `x-ingestion-key` com o valor de `INGESTION_API_KEY` para a API do HQ |
| `ElevenLabs API Key` | Header Auth | Enviar `xi-api-key` para listar, buscar e baixar Atendimentos (ingestão/reconciliação — não é a chave do Monitoramento ao Vivo do HQ) |
| `HQ Audio Storage` | S3 | Gravar o MP3 em MinIO ou storage compatível com S3 |

Os nodes Postgres e HTTP Request devem selecionar essas Credentials pelo seletor do n8n. Não grave senha, token ou connection string em parâmetros dos nodes, Code nodes, variáveis do workflow ou exports JSON.

Os exports sanitizados em `n8n/workflows/` referenciam as Credentials apenas pelo nome. Configure no ambiente da instância:

| Variável | Uso | Padrão |
| --- | --- | --- |
| `HQ_API_URL` | URL interna da API do HQ | obrigatório |
| `STORAGE_BUCKET` | Bucket privado dos áudios (`hq-geap`) | obrigatório para todos os fluxos |
| `ELEVENLABS_WEBHOOK_SECRET` | Validação HMAC do webhook | obrigatório para o webhook |
| `ELEVENLABS_TRANSFER_TOOL_NAME` | Identificador exato da tool de transferência | obrigatório |
| `ELEVENLABS_API_URL` | Base da API, útil para testes controlados | `https://api.elevenlabs.io` |
| `RECONCILIATION_INTERVAL_MINUTES` | Frequência do polling | `5` |
| `RECONCILIATION_LOOKBACK_MINUTES` | Janela consultada a cada execução | `30` |

Para os Code nodes acessarem essas variáveis, defina `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Para a validação HMAC, habilite também `crypto` com `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. Restrinja a edição dos workflows a administradores, pois essas opções dão aos Code nodes acesso ao ambiente do processo.

Distinga as chaves ElevenLabs: `ELEVENLABS_API_KEY` no `.env` do HQ serve **somente** ao Monitoramento ao Vivo (proxy WebSocket no servidor; a chave nunca chega ao browser; ADR-0005). A Credential `ElevenLabs API Key` do n8n serve **somente** à ingestão/reconciliação. A chave do OpenRouter permanece só no Credentials do n8n. Proteja o Form Trigger “Buscar Conversa” com Basic Auth da instância ou restrinja-o à rede interna; o formulário reprocessa Atendimentos e não deve ficar público.

No ambiente local, configure `HQ Audio Storage` para o endpoint S3 `http://localhost:9000`, região `us-east-1`, access key `minioadmin` e secret key `minioadmin`. O Compose cria o bucket `hq-geap`; produção deve usar `STORAGE_BUCKET=hq-geap`, credenciais próprias e bucket privado.

## Verificação antes da ativação

1. Abra cada node que acessa PostgreSQL e confirme que ele referencia `HQ GEAP PostgreSQL`.
2. Abra o node que chama o OpenRouter e confirme que ele referencia `HQ GEAP OpenRouter`.
3. Confirme que o workflow lê `prompt`, `provedor`, `modelo`, `temperatura` e `versao` da única linha ativa de `prompts_ia_avaliadora` antes da chamada ao modelo.
4. Confirme que a Avaliação da IA grava o `prompt_id` dessa mesma linha.
5. Exporte o workflow e verifique que o JSON não contém senha, token nem connection string.
6. Envie uma assinatura inválida e confirme resposta 401 sem execução dos nodes de persistência.
7. Confirme que o nome em `ELEVENLABS_TRANSFER_TOOL_NAME` é exatamente o identificador da ferramenta de transferência configurada na ElevenLabs.
8. Configure um Error Workflow para alertar execuções que esgotarem as três tentativas de download ou upload. Essas execuções podem ser retomadas com segurança porque a ingestão e a chave do objeto são idempotentes.
9. Importe `ingestao-atendimento.json`, `reconciliacao-atendimentos.json` e `reprocessar-atendimento.json`, associe as Credentials nomeadas e confirme que os três publicam em `/atendimentos/ingestao`.
10. Execute “Buscar Conversa” duas vezes com o mesmo `conversation_id` e confirme uma única linha em `atendimentos` e uma única Avaliação da IA.
11. Na reconciliação, force uma falha pontual na ElevenLabs e confirme que a execução registra o erro do item, segue os demais ausentes e não altera Atendimentos já persistidos.

As Credentials são objetos locais da instância n8n e não são exportadas com o workflow. Por isso, sua existência e associação aos nodes são verificações de implantação, não configuração do HQ GEAP.
