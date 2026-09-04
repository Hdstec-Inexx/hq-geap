# HQ GEAP — Qualidade de Agente de Voz

Sistema de qualidade que analisa os atendimentos de um agente de voz: uma IA avalia todas as interações e um Curador humano atua como fallback, gerando insumos para a manutenção contínua do agente.

## Language

### Papéis

**Admin**:
Papel com acesso total: gerencia usuários, configura a IA Avaliadora (prompt, modelo) e trabalha a fila de comentários pendentes.

**Gestão**:
Papel de acompanhamento, 100% leitura. Vê dashboards, relatórios, atendimentos com suas avaliações e comentários — sem escrever nem alterar nada.

**Curador**:
Papel que atua como fallback humano da IA Avaliadora. Escolhe da Fila de Curadoria quais atendimentos revisar, conferindo a avaliação da IA critério a critério, corrigindo o que ela errou e comentando quando necessário. Só avalia após a conclusão do Atendimento.
_Avoid_: Operacional (nome antigo no desenho original)

**Cliente**:
Papel futuro, fora do escopo do MVP. Teria acesso apenas a dashboards.

**Perfil**:
A identidade autenticada no HQ GEAP: quem é a pessoa (nome, e-mail) e qual **papel** exerce (Admin, Gestão ou Curador). É o que a casca autenticada consulta para liberar ou bloquear áreas; mudança de papel ou perda do Perfil (conta desativada / sessão inválida) é o que deve alterar a UI — não o mero fato de o Perfil ter sido revalidado. `GET /me` com Perfil **igual** ao atual é no-op de UX (sem remount, refetch da página ou reabertura do WebSocket do Monitoramento ao Vivo); ver ADR-0013.
_Avoid_: Usuário (ambíguo com conta genérica), sessão (mecanismo de auth, não o conceito de identidade/papel)

**Casca autenticada**:
O enquadramento da UI presente só com Perfil válido: expõe as áreas liberadas ao **papel**, identifica a pessoa pelo nome, permite encerrar a sessão e leva à Home pela marca GEAP. Login e health ficam fora dela. A Home mantém o Perfil completo (nome, e-mail, papel); a casca mostra nome, áreas do papel e encerramento de sessão.
_Avoid_: shell, sidebar (vocabulário de implementação, não de domínio)

### Objeto central

**Atendimento**:
Uma interação completa entre o Agente de Voz e um cliente, do início ao fim do contato. Carrega áudio, transcrição e metadados. Ciclo de vida: `Em andamento` → `Concluído`. Pertence a um Agente de Voz.
_Avoid_: Conversa, ligação, chamada

**Transcrição**:
A sequência ordenada dos turnos de fala entre o Agente de Voz e o cliente, com mensagem, ferramentas e marcação temporal individual de cada turno. É inconsistente quando mais de um turno apresenta tempo zerado ou ausente.
_Avoid_: Linha do tempo, log de mensagens, chat

**Reprocessamento de Transcrição**:
A sincronização da transcrição completa com marcação temporal válida a partir da ElevenLabs para Atendimentos concluídos com transcrição inconsistente. Atualiza o texto, a duração e recalcula o Tempo de Espera, mantendo a Avaliação da IA inalterada.
_Avoid_: Reavaliação, reanálise

**Agente de Voz**:
O agente conversacional (ElevenLabs) que atende os clientes. É o "avaliado" do sistema: configurado na ElevenLabs, observado aqui.

**Motivo de Contato**:
A razão do contato (ex: "Rede credenciada", "Financeiro/Boletos"), coletada pelo próprio Agente de Voz durante o Atendimento (data collection da ElevenLabs) e recebida pronta no webhook. O sistema apenas armazena e agrega; quando ausente na fonte, é representado canonicamente como **Não informado**.

**Transferência**:
Fato objetivo do Atendimento: o contato foi transferido para um número ou humano (a tool de transferência foi executada). "Resolvido sem transferência" é derivado: total − transferidos.

**Custo**:
O custo do Atendimento na ElevenLabs, tal qual exibido por ela após a conclusão. Atributo visível apenas para Admin e Gestão — o Curador não o vê.

**Download de Áudio**:
A exportação do arquivo de áudio (`.mp3`) do Atendimento. Acesso restrito aos papéis **Admin** e **Gestão** (auditoria técnica e arquivamento de contatos). O **Curador** acessa somente a reprodução no player durante a conferência, sem permissão para download.

### Avaliação

**Avaliação**:
O veredito sobre um Atendimento, produzido pela IA Avaliadora ou pelo Curador — as duas coexistem lado a lado quando ambas existem, sem hierarquia, e são snapshots imutáveis. A da IA é gerada para todo Atendimento concluído e carrega: checklist de critérios, **Nota da IA Avaliadora**, falhas identificadas e resumo do atendimento. A do Curador é a **conferência da avaliação da IA** em registro separado: ele confirma ou corrige o shape espelho (checklist, falhas e resumo), sua nota deriva da mesma soma da Régua, registra a **Nota da Avaliação da IA** (0–10, qualidade da própria IA Avaliadora) e pode adicionar um comentário opcional na revisão. Enquanto a conferência humana não for realizada, o painel do Curador não é exibido (sem renderizar card vazio nem mensagem de placeholder) e o painel da Avaliação da IA se expande para ocupar a largura total do container. Quando a avaliação do Curador existir, ambos os painéis coexistem lado a lado. Concordância não é flag gravada — deriva da comparação dos dois snapshots.

**Nota da IA Avaliadora**:
Nota de 0–10 do Atendimento na Régua, produzida pela Avaliação da IA (soma dos critérios atendidos). Distinta da **Nota da Avaliação da IA**.
_Avoid_: Nota IA (ambíguo com Nota da Avaliação da IA)

**Nota da Avaliação da IA**:
Nota de 0–10 que o Curador atribui à qualidade da Avaliação da IA num Atendimento (calibração do avaliador), distinta da **Nota da IA Avaliadora**.
_Avoid_: Nota IA

**Aprovação**:
O veredito final derivado de uma Avaliação: `Aprovado` quando a nota é ≥ 7.0 **e** não houve Falha Crítica; caso contrário, `Reprovado`. Não é dado gravado — é regra de leitura sobre o snapshot.

**Falha Crítica**:
Um Critério marcado como crítico que não foi atendido. Derruba a Aprovação sozinha, independente da nota (ex: "Informação de Protocolo", obrigatório em 100% dos Atendimentos).

**IA Avaliadora**:
A avaliadora primária (LLM), que avalia automaticamente todo Atendimento concluído. É a "régua" do sistema: configurada pelo Admin dentro do sistema (prompt, modelo, temperatura).

**Critério**:
Uma verificação sobre o comportamento do Agente de Voz (ex: "Saudação", "Palavras Proibidas") com três estados: `Atendido` (vale seu valor fixo em pontos), `Não atendido` (zero) ou `Não se aplica` (pontua como atendido — ex: "Validação de E-mail" num Atendimento sem envio de e-mail). Pode ser marcado como **crítico** (ver Falha Crítica) e sua regra de aplicabilidade é parte da definição. A lista e os valores são fixos, definidos pelo desenvolvimento; todos os perfis autenticados apenas consultam. Um Critério pode ter valor 0 quando serve só à calibração (ex: **Uso Correto de Ferramentas**).

**Uso Correto de Ferramentas**:
Critério da Régua (valor 0) que verifica se o Agente de Voz acionou as ferramentas corretas sem uso indevido ou falha operacional. Se não for atendido, **Resolução da Solicitação** também fica não atendida (perde 3,0) — ver ADR-0011.

**Régua de Avaliação**:
O conjunto de critérios ativos cujos valores somam exatamente 10, mais o limiar de Aprovação (nota ≥ 7.0). É a escala contra a qual todo Atendimento é medido, disponível para consulta por todos os perfis autenticados. Sua definição completa é fixa, do desenvolvimento. Inclui Critérios de valor 0 sem alterar a soma.

**Critérios de Não Conformidade**:
Agregação no dashboard que contabiliza o volume e a distribuição de Atendimentos em que cada Critério da Régua foi avaliado como `Não atendido` pela IA Avaliadora no período.

**Concordância**:
A medida de alinhamento entre a Avaliação da IA e a do Curador num mesmo Atendimento — por nota e por critério. É a métrica de calibração da IA Avaliadora: cada critério em que o Curador confirma o check da IA é um acerto dela.

### Manutenção

**Fila de Manutenção**:
A lista de Comentários (pendentes ou resolvidos) agrupados para apoiar a melhoria contínua do Agente de Voz. Permite ao Admin filtrar por status e data de criação do comentário, além de navegar de forma contínua entre os Atendimentos associados até zerar os itens pendentes da fila.

**Comentário**:
Anotação sobre um Atendimento, usada como insumo para ajustes e melhorias do Agente de Voz ou para explicar correções feitas na avaliação da IA. Escrita por Curador ou Admin; lida por Admin e Gestão. Tem status `Pendente` → `Resolvido`, alterável apenas pelo Admin. Cada comentário exibe o autor, status, data de criação e metadados do Atendimento de origem (incluindo nome do Agente de Voz, ID da conversa e data do Atendimento).

### Operação

**Fila de Curadoria**:
A lista de Atendimentos concluídos e já avaliados pela IA, da qual o Curador escolhe livremente quais revisar (modelo pull, sem gatilho automático).

**Minhas Curadorias**:
A lista de Atendimentos concluídos que já receberam conferência humana. Permite ao Curador consultar suas próprias revisões (e aos perfis de Gestão e Admin, auditar o histórico de conferências realizadas sob o nome "Curadorias Realizadas").

**Curadoria no Atendimento**:
Atributo de visualização e filtro na listagem de Atendimentos que indica se a conferência humana já foi realizada e identifica o Curador responsável pela avaliação mais recente.

**Avaliados (IA × Curador)**:
Indicador do dashboard que quantifica o volume de Atendimentos concluídos avaliados pela IA e conferidos por Curadores no período filtrado.

**Monitoramento ao Vivo**:
A observação em tempo real — somente texto, sem áudio — de Atendimentos ainda **abertos na ElevenLabs** (`initiated` / `in-progress`, sem sinais de término, com duração ainda acompanhando o relógio e início recente), via WebSocket. A lista não filtra por dia civil; conversas zombie (status aberto preso na fonte, inclusive no mesmo dia), IDs que só aparecem no filtro aberto (ausentes na listagem geral, mesmo que o monitor ainda responda `history_complete`) e Atendimentos já `concluido` no HQ ficam de fora. Estritamente observacional: nenhuma intervenção no Atendimento.
_Avoid_: Supervisão (implica intervenção, que não existe no MVP)

**Tempo de Espera**:
O intervalo, em segundos, entre a **primeira fala do cliente** e a **segunda fala do agente** (a primeira fala do agente é a apresentação). É fato do Atendimento; não é o TME. Fica `null` quando faltam a primeira fala do cliente, a segunda do agente, ou tempos válidos para calcular a diferença.
_Avoid_: Fila (colide com Fila de Curadoria), instante absoluto desde o início do Atendimento, TME (média, não o intervalo individual)

**TME**:
Tempo Médio de Espera: a média dos Tempos de Espera dos Atendimentos que **têm** Tempo de Espera. Distinto do Tempo de Espera individual (fato do Atendimento). Não é gravado na finalização do Atendimento e **não** é indicador do dashboard.

**SLA**:
Percentual, no dashboard e no período filtrado, dos Atendimentos cujo Tempo de Espera está dentro do prazo (Tempo de Espera ≤ **150 segundos**), sobre o **total** de Atendimentos do período. Atendimento sem Tempo de Espera mensurável não conta como dentro do prazo. O limite define “dentro do prazo”; não é um segundo indicador nem medida de inatividade. A meta de referência é **80%**.
_Avoid_: Inatividade, solicitação (use Atendimento)
