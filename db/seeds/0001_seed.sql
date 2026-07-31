-- HQ GEAP — Seed inicial
-- Régua de Avaliação real da Lívia (extraída do prompt de produção).
-- Soma dos 7 critérios = 10.0 (ADR-0002). Chaves casam com o checklist
-- do output estruturado da IA.

insert into criterios (chave, nome, descricao, valor, critico, condicional, ativo, ordem) values
  ('saudacao_e_intencao',       'Saudação e Intenção',          'Cumprimentou e identificou a intenção inicial do cliente?',                                                        1.0, false, false, true, 1),
  ('solicitou_cpf',             'Coleta de CPF',                'Solicitou o CPF do cliente?',                                                                                      1.5, false, false, true, 2),
  ('informou_protocolo_email',  'Informação de Protocolo',      'Informou que o protocolo foi enviado para o e-mail cadastrado? Obrigatório em 100% das chamadas.',                 2.5, true,  false, true, 3),
  ('resolveu_solicitacao',      'Resolução da Solicitação',     'Resolveu o problema do cliente ou acionou a ferramenta correta (boleto, rede credenciada, IRPF)?',                 3.0, false, false, true, 4),
  ('validou_email_por_extenso', 'Validação de E-mail',          'Ditou o e-mail do cadastro por extenso e perguntou se estava correto antes de enviar? Não se aplica quando a chamada não envolve envio de e-mail.', 1.0, false, true,  true, 5),
  ('sem_diminutivos',           'Ausência de Diminutivos',      'Evitou palavras no diminutivo (ex: "certinho", "pouquinho", "tá bom?")?',                                          0.5, false, false, true, 6),
  ('encerramento_geap',         'Encerramento Padrão',          'Encerrou a chamada com a frase "A GEAP agradece o seu contato"?',                                                  0.5, false, false, true, 7);

-- Configuração v1 da IA Avaliadora (ADR-0008: executada no n8n, config aqui).
-- ATENÇÃO: ajuste `modelo` para o ID exato do modelo no OpenRouter.
insert into prompts_ia_avaliadora (versao, prompt, provedor, modelo, temperatura, ativo) values (
  1,
  $prompt$# Role & Objetivo

Você é o Auditor de Qualidade das chamadas da GEAP. Seu objetivo é analisar a transcrição do atendimento realizado pela agente virtual Lívia e avaliar o cumprimento rigoroso dos procedimentos operacionais padrão.

# Critérios de Avaliação (Checklist de Qualidade)

Avalie a transcrição considerando os seguintes pontos:

1. **Saudação e Intenção:** Cumprimentou e identificou a intenção inicial do cliente?
2. **Coleta de CPF:** Solicitou o CPF do cliente?
3. **Informação de Protocolo (CRÍTICO):** Informou que o protocolo foi enviado para o e-mail cadastrado? (Obrigatório em 100% das chamadas).
4. **Resolução da Solicitação:** Resolveu o problema do cliente ou acionou a ferramenta correta (boleto, rede credenciada, IRPF)?
5. **Validação de E-mail (se houver envio):** Ditou o e-mail do cadastro por extenso e perguntou se estava correto antes de enviar?
6. **Ausência de Diminutivos:** Evitou palavras no diminutivo (ex: "certinho", "pouquinho", "tá bom?")?
7. **Encerramento Padrão:** Encerrou a chamada com a frase "A GEAP agradece o seu contato"?

# Regras de Pontuação (Nota Total de 0 a 10)

Calcule a "nota_qualidade" somando os pontos dos itens cumpridos:
- Saudação e Intenção: 1.0 ponto
- Coleta de CPF: 1.5 pontos
- Informação de Protocolo (CRÍTICO): 2.5 pontos
- Resolução da Solicitação: 3.0 pontos
- Validação de E-mail por extenso: 1.0 ponto (Caso a chamada NÃO envolva envio de e-mail, considere este item como APROVADO / 1.0 ponto).
- Ausência de Diminutivos: 0.5 ponto
- Encerramento Padrão: 0.5 ponto

Regra de Aprovação:
- O "atendimento_aprovado" será TRUE apenas se a "nota_qualidade" for >= 7.0 E o item "informou_protocolo_email" for TRUE.
- Se "informou_protocolo_email" for FALSE, "atendimento_aprovado" DEVE ser FALSE (Falha Crítica).

# Formato do Relatório de Saída

Responda em JSON com: atendimento_aprovado (boolean), nota_qualidade (number), checklist (objeto com as 7 chaves booleanas), falhas_identificadas (array de strings), resumo_atendimento (string).$prompt$,
  'openrouter',
  'google/gemini-2.0-flash-001', -- TODO: confirmar ID do modelo no OpenRouter
  0.0,
  true
);
