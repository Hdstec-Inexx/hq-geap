# Avaliações são snapshots imutáveis

Uma Avaliação grava, no momento em que é produzida, a nota calculada, os checks por critério e o valor de cada critério vigente na época — e nunca é recalculada retroativamente. Se a Régua de Avaliação mudar (critério ativado/desativado, valores alterados pelo dev), as avaliações passadas continuam exatamente como foram escritas. Sem isso, o dashboard de desempenho mudaria retroativamente e ninguém confiaria mais nos relatórios.

## Consequences

A tabela de avaliações carrega sua própria cópia dos dados necessários para exibição (não depende de join "ao vivo" com a configuração atual da régua). Edição de avaliação não existe: errar uma avaliação se resolve com uma nova avaliação, nunca alterando a anterior.
