-- HQ GEAP — Schema inicial
-- Domínio: ver CONTEXT.md | Decisões: ver docs/adr/
-- Nomes em português, seguindo a linguagem ubíqua do projeto.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------
create type papel_usuario as enum ('admin', 'gestao', 'curador');
create type status_atendimento as enum ('em_andamento', 'concluido');
create type estado_criterio as enum ('atendido', 'nao_atendido', 'nao_se_aplica');
create type autor_avaliacao as enum ('ia', 'curador');
create type status_comentario as enum ('pendente', 'resolvido');

-- ---------------------------------------------------------------
-- Papéis (CONTEXT.md → Papéis)
-- ---------------------------------------------------------------
create table usuarios (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  email        text not null unique,
  senha_hash   text not null,
  papel        papel_usuario not null,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Agente de Voz (entidade desde o dia 1, mesmo com 1 registro)
-- ---------------------------------------------------------------
create table agentes_voz (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,                -- ex: Lívia
  elevenlabs_agent_id text not null unique,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Atendimento (objeto central)
-- elevenlabs_conversation_id = chave idempotente de ingestão (ADR-0007)
-- ---------------------------------------------------------------
create table atendimentos (
  id                       uuid primary key default gen_random_uuid(),
  agente_voz_id            uuid not null references agentes_voz(id),
  elevenlabs_conversation_id text not null unique,
  status                   status_atendimento not null default 'em_andamento',
  iniciado_em              timestamptz,
  concluido_em             timestamptz,
  duracao_segundos         integer,
  transcricao              jsonb,              -- linha do tempo da conversa
  audio_url                text,
  motivo_contato           text,               -- data_collection "Classificação" da ElevenLabs
  houve_transferencia      boolean not null default false,
  custo                    numeric(10, 4),     -- custo exibido pela ElevenLabs; visível só p/ Admin e Gestão
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now()
);
create index idx_atendimentos_status on atendimentos(status);
create index idx_atendimentos_concluido_em on atendimentos(concluido_em);
create index idx_atendimentos_agente on atendimentos(agente_voz_id);

-- ---------------------------------------------------------------
-- Critério (lista fixa do dev; Admin só ativa/desativa — ADR-0002/0003)
-- valor: peso fixo; soma dos ativos = 10 (Régua de Avaliação)
-- critico: falha derruba a Aprovação (Falha Crítica)
-- condicional: admite o estado "não se aplica" (pontua como atendido)
-- ---------------------------------------------------------------
create table criterios (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null unique,      -- casa com o checklist do output da IA (ex: informou_protocolo_email)
  nome        text not null,
  descricao   text,
  valor       numeric(4, 2) not null,
  critico     boolean not null default false,
  condicional boolean not null default false,
  ativo       boolean not null default true,
  ordem       smallint not null,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Configuração da IA Avaliadora — versionada (ADR-0006/0008)
-- Uma versão ativa por vez; avaliações referenciam a versão usada.
-- ---------------------------------------------------------------
create table prompts_ia_avaliadora (
  id          uuid primary key default gen_random_uuid(),
  versao      integer not null unique,
  prompt      text not null,
  provedor    text not null default 'openrouter',
  modelo      text not null,
  temperatura numeric(2, 1),
  ativo       boolean not null default false,
  criado_por  uuid references usuarios(id),
  criado_em   timestamptz not null default now()
);
create unique index idx_prompts_apenas_um_ativo on prompts_ia_avaliadora(ativo) where ativo;

-- ---------------------------------------------------------------
-- Avaliação (IA e Curador, lado a lado, sem hierarquia — ADR-0001)
-- Snapshot imutável (ADR-0004): nota gravada; Aprovação é regra de
-- leitura (nota >= 7.0 E sem Falha Crítica) — nunca coluna.
-- unique(atendimento_id, autor): uma da IA + uma do Curador por atendimento.
-- ---------------------------------------------------------------
create table avaliacoes (
  id                  uuid primary key default gen_random_uuid(),
  atendimento_id      uuid not null references atendimentos(id),
  autor               autor_avaliacao not null,
  autor_usuario_id    uuid references usuarios(id),        -- preenchido quando autor = curador
  prompt_id           uuid references prompts_ia_avaliadora(id), -- preenchido quando autor = ia
  nota                numeric(4, 2) not null,
  falhas_identificadas jsonb,                              -- só IA
  resumo_atendimento  text,                                -- só IA
  criado_em           timestamptz not null default now(),
  unique (atendimento_id, autor),
  check (autor = 'ia' or autor_usuario_id is not null)
);
create index idx_avaliacoes_atendimento on avaliacoes(atendimento_id);

-- ---------------------------------------------------------------
-- Check por critério (3 estados) com snapshot do valor (ADR-0004)
-- ---------------------------------------------------------------
create table avaliacao_criterios (
  id             uuid primary key default gen_random_uuid(),
  avaliacao_id   uuid not null references avaliacoes(id) on delete cascade,
  criterio_id    uuid not null references criterios(id),
  estado         estado_criterio not null,
  valor_criterio numeric(4, 2) not null,   -- valor do critério na época da avaliação
  unique (avaliacao_id, criterio_id)
);
create index idx_avaliacao_criterios_criterio on avaliacao_criterios(criterio_id);

-- ---------------------------------------------------------------
-- Comentário (manutenção do agente ou explicação de correção da IA)
-- Autoria: Curador e Admin. Status só o Admin altera.
-- ---------------------------------------------------------------
create table comentarios (
  id              uuid primary key default gen_random_uuid(),
  atendimento_id  uuid not null references atendimentos(id),
  autor_usuario_id uuid not null references usuarios(id),
  texto           text not null,
  status          status_comentario not null default 'pendente',
  resolvido_por   uuid references usuarios(id),
  resolvido_em    timestamptz,
  criado_em       timestamptz not null default now(),
  check ((status = 'resolvido') = (resolvido_em is not null))
);
create index idx_comentarios_status on comentarios(status);
create index idx_comentarios_atendimento on comentarios(atendimento_id);

-- ---------------------------------------------------------------
-- Fila de Curadoria (CONTEXT.md): concluídos com avaliação da IA e
-- sem avaliação do Curador. É query derivada — materializada como view.
-- ---------------------------------------------------------------
create view fila_curadoria as
select a.*
from atendimentos a
join avaliacoes av_ia
  on av_ia.atendimento_id = a.id and av_ia.autor = 'ia'
left join avaliacoes av_cur
  on av_cur.atendimento_id = a.id and av_cur.autor = 'curador'
where a.status = 'concluido'
  and av_cur.id is null;
