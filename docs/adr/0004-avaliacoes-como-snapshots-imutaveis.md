# Avaliações são snapshots imutáveis

Uma Avaliação grava, no momento em que é produzida, a nota calculada, os checks por critério e o valor de cada critério vigente na época — e nunca é recalculada retroativamente. Se a Régua de Avaliação mudar (critério ativado/desativado, valores alterados pelo dev), as avaliações passadas continuam exatamente como foram escritas. Sem isso, o dashboard de desempenho mudaria retroativamente e ninguém confiaria mais nos relatórios.

## Consequences

A tabela de avaliações carrega sua própria cópia dos dados necessários para exibição (não depende de join "ao vivo" com a configuração atual da régua). Edição de Avaliação não existe: errar uma Avaliação se resolve com uma nova, nunca alterando a anterior. Para o Curador, a revisão mais recente participa da Concordância corrente e as anteriores permanecem no histórico.
