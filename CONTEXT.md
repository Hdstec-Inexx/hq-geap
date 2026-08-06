# HQ GEAP — Qualidade de Agente de Voz

Sistema de qualidade que analisa os atendimentos de um agente de voz: uma IA avalia todas as interações e um Curador humano atua como fallback, gerando insumos para a manutenção contínua do agente.

## Language

### Papéis

**Admin**:
Papel com acesso total: gerencia usuários, configura a IA Avaliadora (prompt, modelo), consulta a Régua de Avaliação e trabalha a fila de comentários pendentes.

**Gestão**:
Papel de acompanhamento, 100% leitura. Vê dashboards, relatórios, atendimentos com suas avaliações e comentários — sem escrever nem alterar nada.

**Curador**:
Papel que atua como fallback humano da IA Avaliadora. Escolhe da Fila de Curadoria quais atendimentos revisar, conferindo a avaliação da IA critério a critério, corrigindo o que ela errou e comentando quando necessário. Só avalia após a conclusão do Atendimento.
_Avoid_: Operacional (nome antigo no desenho original)

**Cliente**:
Papel futuro, fora do escopo do MVP. Teria acesso apenas a dashboards.

### Objeto central

**Atendimento**:
Uma interação completa entre o Agente de Voz e um cliente, do início ao fim do contato. Carrega áudio, transcrição e metadados. Ciclo de vida: `Em andamento` → `Concluído`. Pertence a um Agente de Voz.
_Avoid_: Conversa, ligação, chamada

**Agente de Voz**:
O agente conversacional (ElevenLabs) que atende os clientes. É o "avaliado" do sistema: configurado na ElevenLabs, observado aqui.

**Motivo de Contato**:
A razão do contato (ex: "Rede credenciada", "Financeiro/Boletos"), coletada pelo próprio Agente de Voz durante o Atendimento (data collection da ElevenLabs) e recebida pronta no webhook. O sistema apenas armazena e agrega.

**Transferência**:
Fato objetivo do Atendimento: o contato foi transferido para um número ou humano (a tool de transferência foi executada). "Resolvido sem transferência" é derivado: total − transferidos.

**Custo**:
O custo do Atendimento na ElevenLabs, tal qual exibido por ela após a conclusão. Atributo visível apenas para Admin e Gestão — o Curador não o vê.

### Avaliação

**Avaliação**:
O veredito sobre um Atendimento, produzido pela IA Avaliadora ou pelo Curador — as duas coexistem lado a lado, sem hierarquia, e são snapshots imutáveis. A da IA carrega: checklist de critérios, nota de 0–10 (soma dos atendidos), falhas identificadas e resumo do atendimento. A do Curador é a **conferência da avaliação da IA** em registro separado: ele confirma ou corrige o shape espelho (checklist, falhas e resumo), sua nota deriva da mesma soma da Régua, registra a **Nota da Avaliação da IA** (0–10, qualidade da própria IA Avaliadora) e pode adicionar um comentário opcional na revisão. Concordância não é flag gravada — deriva da comparação dos dois snapshots.

**Nota da Avaliação da IA**:
Nota de 0–10 que o Curador atribui à qualidade da Avaliação da IA num Atendimento (calibração do avaliador), distinta da nota do Atendimento na Régua.

**Aprovação**:
O veredito final derivado de uma Avaliação: `Aprovado` quando a nota é ≥ 7.0 **e** não houve Falha Crítica; caso contrário, `Reprovado`. Não é dado gravado — é regra de leitura sobre o snapshot.

**Falha Crítica**:
Um Critério marcado como crítico que não foi atendido. Derruba a Aprovação sozinha, independente da nota (ex: "Informação de Protocolo", obrigatório em 100% dos Atendimentos).

**IA Avaliadora**:
A avaliadora primária (LLM), que avalia automaticamente todo Atendimento concluído. É a "régua" do sistema: configurada pelo Admin dentro do sistema (prompt, modelo, temperatura).

**Critério**:
Uma verificação sobre o comportamento do Agente de Voz (ex: "Saudação", "Palavras Proibidas") com três estados: `Atendido` (vale seu valor fixo em pontos), `Não atendido` (zero) ou `Não se aplica` (pontua como atendido — ex: "Validação de E-mail" num Atendimento sem envio de e-mail). Pode ser marcado como **crítico** (ver Falha Crítica) e sua regra de aplicabilidade é parte da definição. A lista e os valores são fixos, definidos pelo desenvolvimento; o Admin apenas consulta. Um Critério pode ter valor 0 quando serve só à calibração (ex: **Uso Correto de Ferramentas**).

**Uso Correto de Ferramentas**:
Critério da Régua (valor 0) que verifica se o Agente de Voz acionou as ferramentas corretas sem uso indevido ou falha operacional. Se não for atendido, **Resolução da Solicitação** também fica não atendida (perde 3,0) — ver ADR-0011.

**Régua de Avaliação**:
O conjunto de critérios ativos cujos valores somam exatamente 10, mais o limiar de Aprovação (nota ≥ 7.0). É a escala contra a qual todo Atendimento é medido. Sua definição completa é fixa, do desenvolvimento. Inclui Critérios de valor 0 sem alterar a soma.

**Concordância**:
A medida de alinhamento entre a Avaliação da IA e a do Curador num mesmo Atendimento — por nota e por critério. É a métrica de calibração da IA Avaliadora: cada critério em que o Curador confirma o check da IA é um acerto dela.

### Manutenção

**Comentário**:
Anotação sobre um Atendimento, usada como insumo para ajustes e melhorias do Agente de Voz ou para explicar correções feitas na avaliação da IA. Escrita por Curador ou Admin; lida por Admin e Gestão. Tem status `Pendente` → `Resolvido`, alterável apenas pelo Admin.

### Operação

**Fila de Curadoria**:
A lista de Atendimentos concluídos e já avaliados pela IA, da qual o Curador escolhe livremente quais revisar (modelo pull, sem gatilho automático).

**Monitoramento ao Vivo**:
A observação em tempo real — somente texto, sem áudio — de Atendimentos ainda **abertos na ElevenLabs** (`initiated` / `in-progress`, sem sinais de término, com duração ainda acompanhando o relógio e início recente), via WebSocket. A lista não filtra por dia civil; conversas zombie (status aberto preso na fonte, inclusive no mesmo dia), IDs que só aparecem no filtro aberto (ausentes na listagem geral, mesmo que o monitor ainda responda `history_complete`) e Atendimentos já `concluido` no HQ ficam de fora. Estritamente observacional: nenhuma intervenção no Atendimento.
_Avoid_: Supervisão (implica intervenção, que não existe no MVP)
