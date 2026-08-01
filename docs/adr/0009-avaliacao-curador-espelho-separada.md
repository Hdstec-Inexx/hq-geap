# ADR-0009: Avaliação do Curador em aggregate separado com shape espelho

## Status

Aceito (grilling #33; implementação #38).

## Contexto

A Avaliação da IA passou a persistir o contrato tipado da LLM (booleans + claims). A conferência humana precisa coexistir sem hierarquia (ADR-0001) e sem mutar o snapshot da IA (ADR-0004). Uma flag `concordou` não captura Concordância por critério/nota.

## Decisão

1. Persistência tipada da Avaliação da IA fica 1:1 com o contrato da LLM (ver #37).
2. A Avaliação do Curador vive em aggregate/tabela separada, ligada à Avaliação da IA (`avaliacao_ia_id`), sem sobrescrever linhas `autor = 'ia'`.
3. O Curador corrige o shape espelho (checklist na Régua, falhas, resumo); a nota do Atendimento continua sendo a soma da Régua (ADR-0002).
4. O Curador registra `nota_avaliacao_ia` (0–10) — qualidade da própria IA Avaliadora — e um comentário opcional na revisão.
5. Não existe coluna/flag `concordou`; Concordância é derivada da comparação dos dois snapshots.

## Consequências

- Views `fila_curadoria` e `avaliacoes_curador_mais_recentes`, dashboards e Concordância leem o aggregate do Curador.
- `avaliacoes` passa a aceitar somente `autor = 'ia'`.
- O comentário opcional da revisão não é o entity **Comentário** da fila de manutenção (`Pendente` → `Resolvido`).
