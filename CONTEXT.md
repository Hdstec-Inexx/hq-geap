# HQ GEAP — Qualidade de Agente de Voz

Sistema de qualidade que analisa os atendimentos de um agente de voz: uma IA avalia todas as interações e um Curador humano atua como fallback, gerando insumos para a manutenção contínua do agente.

## Language

### Papéis

**Admin**:
Papel com acesso total: gerencia usuários, configura a IA Avaliadora (prompt, modelo), gerencia categorias de negócio, ativa/desativa critérios e trabalha a fila de comentários pendentes.

**Gestão**:
Papel de acompanhamento, 100% leitura. Vê dashboards, relatórios, atendimentos com suas avaliações e comentários — sem escrever nem alterar nada.

**Curador**:
Papel que atua como fallback humano da IA Avaliadora. Escolhe da Fila de Curadoria quais atendimentos revisar, avaliando, classificando e comentando. Só avalia após a conclusão do Atendimento.
_Avoid_: Operacional (nome antigo no desenho original)

**Cliente**:
Papel futuro, fora do escopo do MVP. Teria acesso apenas a dashboards.

### Objeto central

**Atendimento**:
Uma interação completa entre o Agente de Voz e um cliente, do início ao fim da chamada. Carrega áudio, transcrição e metadados. Ciclo de vida: `Em andamento` → `Concluído`. Pertence a um Agente de Voz.
_Avoid_: Conversa, ligação, chamada

**Agente de Voz**:
O agente conversacional (ElevenLabs) que atende os clientes. É o "avaliado" do sistema: configurado na ElevenLabs, observado aqui.

**Motivo de Contato**:
A razão da ligação (ex: "Rede credenciada", "Financeiro/Boletos"), coletada pelo próprio Agente de Voz durante a chamada (data collection da ElevenLabs) e recebida pronta no webhook. O sistema apenas armazena e agrega.

**Transferência**:
Fato objetivo do Atendimento: a chamada foi transferida para um número/humano (a tool de transferência foi executada). "Resolvida sem transferência" é derivado: total − transferidas.

### Avaliação

**Avaliação**:
O veredito sobre um Atendimento: nota de 0–10 (soma dos critérios atendidos), uma Categoria de Negócio e justificativa opcional em texto. Produzida pela IA Avaliadora ou pelo Curador — as duas coexistem lado a lado, sem hierarquia, e são snapshots imutáveis.

**IA Avaliadora**:
A avaliadora primária (LLM), que avalia automaticamente todo Atendimento concluído. É a "régua" do sistema: configurada pelo Admin dentro do sistema (prompt, modelo, temperatura).

**Critério**:
Uma verificação binária sobre o comportamento do Agente de Voz (ex: "Saudação", "Palavras Proibidas"): vale seu valor fixo em pontos quando atendido, ou zero. A lista é fixa, definida pelo desenvolvimento; o Admin apenas ativa/desativa.

**Régua de Avaliação**:
O conjunto de critérios ativos cujos valores somam exatamente 10. É a escala contra a qual todo Atendimento é medido.

**Categoria de Negócio**:
Classificação qualitativa do Atendimento em linguagem da operação (ex: "cliente satisfeito", "não resolveu o problema"). Lista gerenciada pelo Admin; itens são desativados, nunca excluídos.
_Avoid_: Classificação (termo reservado ao ato; use para a ação, não para a lista)

**Concordância**:
A medida de alinhamento entre a Avaliação da IA e a do Curador num mesmo Atendimento — por nota, categoria e critério. É a métrica de calibração da IA Avaliadora.

### Manutenção

**Comentário**:
Anotação sobre um Atendimento, usada como insumo para ajustes e melhorias do Agente de Voz. Escrita por Curador ou Admin; lida por Admin e Gestão. Tem status `Pendente` → `Resolvido`, alterável apenas pelo Admin.

### Operação

**Fila de Curadoria**:
A lista de Atendimentos concluídos e já avaliados pela IA, da qual o Curador escolhe livremente quais revisar (modelo pull, sem gatilho automático).

**Monitoramento ao Vivo**:
A observação em tempo real — somente texto, sem áudio — de um Atendimento `Em andamento`, via WebSocket da ElevenLabs. Estritamente observacional: nenhuma intervenção na chamada.
_Avoid_: Supervisão (implica intervenção, que não existe no MVP)
