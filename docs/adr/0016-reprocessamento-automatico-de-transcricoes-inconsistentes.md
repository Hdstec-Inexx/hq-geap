# Reprocessamento automático de transcrições inconsistentes e recálculo de Tempo de Espera

Atendimentos concluídos recebidos sem marcação temporal de turnos na transcrição (mais de um turno com timestamp zerado ou ausente) são elegíveis para reprocessamento automático pelo Polling de Reconciliação e por saneamento periódico. O reprocessamento consulta a API da ElevenLabs para obter os timestamps reais por turno, atualiza a transcrição e a duração da chamada, e recalcula o Tempo de Espera (`tme_segundos`) pelo intervalo entre a primeira fala do cliente e a segunda do agente. A Avaliação da IA existente permanece estritamente inalterada como snapshot imutável (conforme ADR-0004 e ADR-0007).

## Consequences

A detecção de inconsistência considera Atendimentos com mais de um turno em `00:00` ou nulo. O reprocessamento nunca dispara nova avaliação por LLM nem altera a nota ou critérios atribuídos originalmente.
