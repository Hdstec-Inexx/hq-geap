# Ingestão via webhook pós-chamada com polling de reconciliação

O Atendimento entra no sistema principalmente por push: a ElevenLabs dispara um webhook pós-chamada para o n8n ao fim de cada ligação, com transcrição, metadados e `data_collection_results`. Como rede de segurança, um polling agendado (reconciliação) lista conversas recentes na API da ElevenLabs e ingere o que ficou faltando — cobrindo indisponibilidades do endpoint, que em push puro significariam eventos perdidos. O fluxo manual "Buscar Conversa" (GET por ID) permanece como ferramenta de backfill e reprocessamento.

## Consequences

Todo Atendimento precisa de uma chave idempotente (o ID da conversa na ElevenLabs): o mesmo atendimento pode chegar pelo webhook e depois pelo polling, e a ingestão deve ignorar duplicatas. Reprocessamento nunca pode gerar uma segunda avaliação da IA para o mesmo Atendimento.
