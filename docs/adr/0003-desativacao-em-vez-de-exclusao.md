# Taxonomias são desativadas, nunca excluídas

Categorias de Negócio (gerenciadas pelo Admin) e Critérios (fixos, ativados/desativados pelo Admin) jamais sofrem exclusão física: são desativados. A alternativa — exclusão real — quebraria relatórios e deixaria avaliações históricas órfãs de suas referências. Itens desativados somem das avaliações novas, mas o histórico antigo permanece íntegro e exibível.

## Consequences

Toda query de listagem para uso em novas avaliações precisa filtrar por ativo; toda query de histórico/relatório não pode filtrar. O botão "Excluir" na UI do Admin executa desativação por baixo dos panos.
