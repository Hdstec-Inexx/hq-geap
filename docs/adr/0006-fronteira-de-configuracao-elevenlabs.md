# Fronteira de configuração: o sistema configura a régua, a ElevenLabs configura o avaliado

Dentro do nosso sistema, o Admin configura apenas a IA Avaliadora: prompt de avaliação, modelo/temperatura, ativação de critérios e categorias de negócio. O Agente de Voz (prompt, voz, tools, data collection) é editado exclusivamente no dashboard da ElevenLabs — re-implementar essa edição via API seria duplicar a ElevenLabs com custo alto e zero valor diferencial. O loop de manutenção fecha assim: Comentário `Pendente` → Admin edita o agente na ElevenLabs → marca o comentário `Resolvido` no nosso sistema.

## Consequences

Motivos de Contato chegam prontos via `data_collection_results` do webhook e o sistema apenas os armazena e agrega (não há CRUD de motivos aqui — a lista vive na configuração do agente na ElevenLabs). Se um dia o produto quiser editar o agente por dentro, isso é uma reversão de fronteira que exige novo ADR.
