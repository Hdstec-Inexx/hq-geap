# Critérios são desativados por migration, nunca excluídos

Quando o desenvolvimento substituir uma Régua, Critérios retirados jamais sofrem exclusão física: uma migration os desativa. A alternativa — exclusão real — quebraria relatórios e deixaria Avaliações históricas órfãs de suas referências. O Admin não executa essa mudança pela UI no MVP.

## Consequences

Toda query para produzir novas Avaliações precisa usar apenas a versão vigente da Régua; queries de histórico e relatório preservam Critérios desativados. A área do Admin é somente leitura para Critérios.
