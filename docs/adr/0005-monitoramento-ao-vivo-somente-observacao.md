# Monitoramento ao Vivo é somente observação

O Monitoramento ao Vivo usa o WebSocket de monitoramento da ElevenLabs (eventos de texto, sem áudio) para o Curador acompanhar Atendimentos `Em andamento` — e nada mais. O mesmo canal aceitaria comandos de controle (encerrar Atendimento, transferir, takeover), mas nenhum é exposto: intervenção transformaria o produto de qualidade numa ferramenta de operação de call center, exigindo auditoria de intervenções, novas permissões e treinamento. Se a operação um dia pedir intervenção, será um módulo separado com entidade Intervenção e ADR próprio.

## Consequences

O cliente WebSocket abre conexão em modo estritamente leitura; qualquer código de envio de comando não existe no repositório (nem "para uso futuro"). Dois avisos da documentação da ElevenLabs ficam registrados: o recurso exige plano Enterprise, e o stream não inclui áudio — só eventos de texto e metadados.
