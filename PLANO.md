# HQ GEAP — Plano de Implementação

Plano em fases do sistema de qualidade do agente de voz. A linguagem de domínio está em [CONTEXT.md](./CONTEXT.md) e as decisões estruturais em [docs/adr/](./docs/adr/). Ler ambos antes de codar.

**Stack:** Node.js/Fastify (API), React (front), PostgreSQL (dados), Redis (cache/filas), MinIO + Google Cloud (áudio), OpenRouter (provedor da IA Avaliadora), n8n (ingestão, execução e persistência da avaliação, ADR-0007/0008) e ElevenLabs API.

**Premissa de conta:** o Monitoramento ao Vivo exige plano **Enterprise** da ElevenLabs (ver ADR-0005). Confirmar antes da Fase 4.

---

## Fase 0 — Fundação

- Setup do repo (API Node + front React), migrations, CI básico.
- Autenticação e autorização com os 3 papéis: `Admin`, `Gestão`, `Curador` (ver CONTEXT.md → Papéis).
- CRUD de usuários (somente Admin).
- Entidade `Agente de Voz` (mesmo com um único registro — todo Atendimento pertence a um).

## Fase 1 — Ingestão do Atendimento

- Fluxo principal: webhook pós-chamada da ElevenLabs → n8n → API (ver ADR-0007).
- Rede de segurança: polling de reconciliação agendado (n8n lista conversas recentes e ingere faltantes).
- Backfill/reprocessamento: fluxo manual "Buscar Conversa" (GET por ID), já existente no n8n.
- Ingestão idempotente pela chave da conversa ElevenLabs (sem duplicar atendimento nem avaliação).
- Persistir: metadados, transcrição, `data_collection_results` (Motivo de Contato), `houve_transferência` (fato: tool de transferência executada), duração (TMA) e Custo.
- Áudio no MinIO/Google Cloud, referência no PostgreSQL.
- Ciclo de vida do Atendimento: `Em andamento` → `Concluído`.

## Fase 2 — IA Avaliadora

- Tabela fixa de Critérios com valores (Régua = 10; ver ADR-0002), seed com os 7 critérios do prompt atual da Lívia.
- Configuração da IA Avaliadora versionada no banco (prompt, provedor, modelo, temperatura), editável pelo Admin (ADR-0006/0008). Provedor atual: **OpenRouter**.
- Execução e persistência da avaliação no n8n (ADR-0008): após a conclusão, o workflow lê a config ativa, chama o LLM e grava o snapshot diretamente no PostgreSQL por uma operação transacional. O HQ apenas consulta os dados gravados e deriva a Aprovação (nota ≥ 7.0 E sem Falha Crítica).
- Avaliação referencia a versão do prompt que a produziu (recorte de Concordância por versão).

## Fase 3 — Curador

- Fila de Curadoria: lista de Atendimentos concluídos e avaliados pela IA (modelo pull — o Curador escolhe).
- Tela de revisão: player de áudio + transcrição + avaliação da IA ao lado da conferência do Curador (critérios confirmados ou corrigidos → nota por soma).
- Comentários no Atendimento (autoria: Curador e Admin; status inicial `Pendente`).
- Regra dura: avaliação do Curador **só após** `Concluído`.

## Fase 4 — Monitoramento ao Vivo

- Lista de Atendimentos `Em andamento`.
- Conexão WebSocket ao endpoint de monitoramento da ElevenLabs, **somente leitura** (ADR-0005): transcrição rolando em tempo real, sem áudio, sem nenhum comando de controle.

## Fase 5 — Dashboards da Gestão

- Filtro de período em todos os painéis.
- KPIs: Total de Atendimentos, TMA, Nota Média (par IA × Curador), Transferências, Resolvidas sem transferência (derivado), Custo total e Custo médio.
- Donut de Motivos de Contato (agregação dos valores recebidos no webhook).
- Barras de % de acerto por Critério.
- Concordância IA × Curador (nota e critério) nos Atendimentos revisados.
- Ranking dos piores Atendimentos.
- Gestão lê Comentários no contexto do Atendimento (leitura apenas).

## Fase 6 — Admin

- Ativação/desativação de Critérios (sem criação/edição de valores — ADR-0002).
- Fila de Comentários `Pendente` → marcar `Resolvido` (a lista de trabalho da manutenção do agente).
- Gestão de usuários e configuração da IA Avaliadora (das Fases 0 e 2, consolidadas na área do Admin).

---

## Fora do MVP (decidido nas sessões de domínio)

- Papel `Cliente` (dashboards externos).
- Intervenção em chamadas ao vivo (encerrar, transferir, takeover) — ver ADR-0005.
- Edição do Agente de Voz por dentro do sistema — ver ADR-0006.
- Critérios fracionáveis e pesos editáveis — ver ADR-0002.
- Métricas de produtividade do Curador.
- Filtro por Agente de Voz na UI (o dado já estará no banco).

## Pendente antes do go-live

- Política de retenção de áudio e adequação à LGPD (os Atendimentos carregam voz de clientes).
- Confirmar plano Enterprise da ElevenLabs (Fase 4).
