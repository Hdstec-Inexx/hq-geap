# Credentials dos workflows n8n

O workflow de avaliação é implantado e mantido no n8n, fora deste repositório. Antes de ativá-lo, configure no cofre de **Credentials** da instância:

| Nome recomendado | Tipo no n8n | Uso |
| --- | --- | --- |
| `HQ GEAP PostgreSQL` | Postgres | Ler a configuração ativa e persistir a Avaliação e seus checks |
| `HQ GEAP OpenRouter` | Header Auth | Enviar `Authorization: Bearer <token>` nas chamadas ao OpenRouter |
| `HQ Ingestion API Key` | Header Auth | Enviar `x-ingestion-key` com o valor de `INGESTION_API_KEY` para a API do HQ |
| `ElevenLabs API Key` | Header Auth | Enviar `xi-api-key` para baixar o áudio da conversa |
| `HQ Audio Storage` | S3 | Gravar o MP3 em MinIO ou storage compatível com S3 |

Os nodes Postgres e HTTP Request devem selecionar essas Credentials pelo seletor do n8n. Não grave senha, token ou connection string em parâmetros dos nodes, Code nodes, variáveis do workflow ou exports JSON.

O export sanitizado `n8n/workflows/ingestao-atendimento.json` referencia as Credentials apenas pelo nome. Configure `HQ_API_URL`, `STORAGE_BUCKET`, `ELEVENLABS_WEBHOOK_SECRET` e `ELEVENLABS_TRANSFER_TOOL_NAME` no ambiente da instância. Para o Code node validar o HMAC, habilite `crypto` com `NODE_FUNCTION_ALLOW_BUILTIN=crypto` e permita `$env` com `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Restrinja edição do workflow a administradores, pois essa opção dá aos Code nodes acesso ao ambiente do processo.

No ambiente local, configure `HQ Audio Storage` para o endpoint S3 `http://localhost:9000`, região `us-east-1`, access key `minioadmin` e secret key `minioadmin`. O Compose cria o bucket `hq-geap-audio`; produção deve usar credenciais próprias e bucket privado.

## Verificação antes da ativação

1. Abra cada node que acessa PostgreSQL e confirme que ele referencia `HQ GEAP PostgreSQL`.
2. Abra o node que chama o OpenRouter e confirme que ele referencia `HQ GEAP OpenRouter`.
3. Confirme que o workflow lê `prompt`, `provedor`, `modelo`, `temperatura` e `versao` da única linha ativa de `prompts_ia_avaliadora` antes da chamada ao modelo.
4. Confirme que a Avaliação da IA grava o `prompt_id` dessa mesma linha.
5. Exporte o workflow e verifique que o JSON não contém senha, token nem connection string.
6. Envie uma assinatura inválida e confirme resposta 401 sem execução dos nodes de persistência.
7. Confirme que o nome em `ELEVENLABS_TRANSFER_TOOL_NAME` é exatamente o identificador da ferramenta de transferência configurada na ElevenLabs.
8. Configure um Error Workflow para alertar execuções que esgotarem as três tentativas de download, upload ou atualização da referência. Essas execuções podem ser retomadas com segurança porque a ingestão e a chave do objeto são idempotentes.

As Credentials são objetos locais da instância n8n e não são exportadas com o workflow. Por isso, sua existência e associação aos nodes são verificações de implantação, não configuração do HQ GEAP.
