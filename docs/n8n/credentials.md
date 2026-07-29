# Credentials do workflow de avaliação

O workflow de avaliação é implantado e mantido no n8n, fora deste repositório. Antes de ativá-lo, configure no cofre de **Credentials** da instância:

| Nome recomendado | Tipo no n8n | Uso |
| --- | --- | --- |
| `HQ GEAP PostgreSQL` | Postgres | Ler a configuração ativa e persistir a Avaliação e seus checks |
| `HQ GEAP OpenRouter` | Header Auth | Enviar `Authorization: Bearer <token>` nas chamadas ao OpenRouter |

Os nodes Postgres e HTTP Request devem selecionar essas Credentials pelo seletor do n8n. Não grave senha, token ou connection string em parâmetros dos nodes, Code nodes, variáveis do workflow ou exports JSON.

## Verificação antes da ativação

1. Abra cada node que acessa PostgreSQL e confirme que ele referencia `HQ GEAP PostgreSQL`.
2. Abra o node que chama o OpenRouter e confirme que ele referencia `HQ GEAP OpenRouter`.
3. Confirme que o workflow lê `prompt`, `provedor`, `modelo`, `temperatura` e `versao` da única linha ativa de `prompts_ia_avaliadora` antes da chamada ao modelo.
4. Confirme que a Avaliação da IA grava o `prompt_id` dessa mesma linha.
5. Exporte o workflow e verifique que o JSON não contém senha, token nem connection string.

As Credentials são objetos locais da instância n8n e não são exportadas com o workflow. Por isso, sua existência e associação aos nodes são verificações de implantação, não configuração do HQ GEAP.
