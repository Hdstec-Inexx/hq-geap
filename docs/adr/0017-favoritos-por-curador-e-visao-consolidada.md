# Favoritos por Curador com desfecho individual e visão consolidada de Gestão

A funcionalidade de Favorito permite registrar que o Agente de Voz teve ótimo desempenho em um Atendimento já persistido no HQ. Optou-se por uma relação independente por par `(perfil_id, atendimento_id)` com carimbo de marcação (`favoritado_em`), em vez de uma flag única no Atendimento. Cada Curador marca e desfaz exclusivamente o seu próprio Favorito, visualizando somente o seu estado ativo; Perfis desativados mantêm seus registros no histórico e nenhum papel (incluindo Admin) tem permissão de apagar marcas de terceiros.

Para Gestão e Admin, cada Atendimento com ao menos um Favorito ativo aparece uma única vez nas listagens, exibindo a contagem e os nomes dos Perfis via tooltip (`★ N`), com ordenação baseada no Favorito mais recente ainda vigente (`MAX(favoritado_em)`). A lista de Favoritos é atemporal (sem mês civil implícito), acessível por item próprio no menu lateral da Casca Autenticada, com busca essencial por Agente de Voz e ID da conversa e filtro por Perfil para Gestão e Admin. A marcação não gera métricas nos Dashboards nem no Pulso da Operação.

## Consequences

1. Desfazer um Favorito afeta apenas a visão do respectivo Curador; o Atendimento permanece visível para Gestão e Admin enquanto houver ao menos um Favorito ativo de outro Perfil.
2. A ordenação consolidada é recalculada dinamicamente com base nas marcas ativas remanescentes quando um Curador remove seu Favorito.
3. No Monitoramento ao Vivo, a ação de favoritar permanece desabilitada até que a chamada seja ingerida e persistida no banco do HQ.
