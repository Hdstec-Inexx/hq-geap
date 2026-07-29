# Ingestão via webhook pós-Atendimento com polling de reconciliação

O Atendimento entra no sistema principalmente por push: a ElevenLabs dispara um webhook pós-Atendimento para o n8n ao fim do contato, com transcrição, metadados e `data_collection_results`. Como rede de segurança, um polling agendado lista Atendimentos recentes na API da ElevenLabs e ingere o que ficou faltando — cobrindo indisponibilidades do endpoint, que em push puro significariam eventos perdidos. O fluxo manual "Buscar Conversa" (GET por ID) permanece como ferramenta de backfill e reprocessamento.

## Consequences

Todo Atendimento usa o `conversation_id` externo da ElevenLabs como chave idempotente: o mesmo Atendimento pode chegar pelo webhook e depois pelo polling, e a ingestão deve ignorar duplicatas. Reprocessamento nunca pode gerar uma segunda Avaliação da IA para o mesmo Atendimento.
