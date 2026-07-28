# Nota 0–10 é a soma de critérios binários de valor fixo

A nota de uma Avaliação não é um julgamento livre: cada Critério (ex: "Saudação", "Palavras Proibidas") tem um valor fixo em pontos, vale o valor cheio quando atendido e zero quando não, e a nota é a soma — a Régua de Avaliação completa soma exatamente 10. A lista de critérios e seus valores é definida pelo desenvolvimento; o Admin apenas ativa/desativa critérios, sem criar novos nem alterar valores. Rejeitamos pesos editáveis pela UI porque um critério criado por clique exigiria redistribuir a nota 10 — decisão de negócio + dev, não de tela — e destruiria a comparabilidade estatística do painel "% de acertos por critério" ao longo do tempo.

## Consequences

Nascer um critério novo (ou mudar um valor) é mudança de código/configuração, com redistribuição explícita da Régua. Critérios fracionáveis ("meio ponto") ficam como evolução futura possível; no MVP são estritamente binários, o que torna a Concordância IA×Curador mensurável de forma limpa.
