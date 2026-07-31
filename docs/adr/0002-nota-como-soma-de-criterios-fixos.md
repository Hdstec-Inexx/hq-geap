# Nota 0–10 é a soma de critérios binários de valor fixo

A nota de uma Avaliação não é um julgamento livre: cada Critério (ex: "Saudação", "Palavras Proibidas") tem um valor fixo em pontos, vale o valor cheio quando atendido e zero quando não, e a nota é a soma — a Régua de Avaliação completa soma exatamente 10. A lista de Critérios e seus valores é definida pelo desenvolvimento e somente consultada pelo Admin. Rejeitamos mutações pela UI porque retirar um dos sete Critérios positivos deixaria a Régua abaixo de 10, enquanto criar ou reponderar por clique destruiria a comparabilidade estatística do painel "% de acertos por Critério" ao longo do tempo.

## Consequences

Adicionar, retirar ou mudar o valor de um Critério exige código/migration, com nova Régua válida e redistribuição explícita até 10. O Admin não ativa, desativa, cria nem edita Critérios no MVP. Critérios fracionáveis ("meio ponto") ficam como evolução futura possível; no MVP são estritamente binários, o que torna a Concordância IA×Curador mensurável de forma limpa.
