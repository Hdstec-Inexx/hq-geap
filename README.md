# HQ GEAP

Sistema de qualidade dos Atendimentos realizados pela agente de voz Lívia. A API usa Fastify, a interface usa React e os dados vivem no PostgreSQL.

## Desenvolvimento local

Pré-requisitos: Node.js 24, Corepack e Docker com Compose.

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` inicia o PostgreSQL, aplica a migration e o seed pendentes e sobe:

- interface em `http://localhost:5173`;
- API em `http://localhost:3000`;
- saúde ponta a ponta em `http://localhost:5173/health`.

As configurações locais possuem valores padrão compatíveis com `compose.yaml`. Para sobrescrevê-las, crie um `.env` na raiz com as variáveis documentadas em `.env.example`. Variáveis fornecidas diretamente pelo ambiente têm precedência sobre o arquivo.

## Deploy (Easypanel / VPS)

Produção usa `Dockerfile` (API) e `Dockerfile.web` (UI) porque a API e a interface compartilham paths. Guia: [`docs/deploy/easypanel.md`](./docs/deploy/easypanel.md). Referência Compose: `compose.easypanel.yaml`.

## Verificações

Com o banco do Compose ativo:

```bash
pnpm typecheck
pnpm test:unit
pnpm db:validate
pnpm exec playwright install chromium
pnpm test
```

`db:validate` aplica migration e seed dentro de uma transação isolada e confirma que a Régua inicial contém sete Critérios ativos somando exatamente 10, além de uma configuração ativa da IA Avaliadora.

## Integração do n8n

O workflow consulta diretamente a única linha ativa de `prompts_ia_avaliadora`, que expõe `prompt`, `provedor`, `modelo`, `temperatura` e `versao`. As credenciais de PostgreSQL e OpenRouter pertencem ao cofre de Credentials do n8n e não devem ser copiadas para o `.env` do HQ GEAP nem gravadas no workflow. A Credential ElevenLabs do n8n cobre ingestão/reconciliação; o Monitoramento ao Vivo usa `ELEVENLABS_API_KEY` no `.env` do HQ (somente no servidor). O provisionamento e a verificação dessas Credentials estão descritos em [`docs/n8n/credentials.md`](./docs/n8n/credentials.md).
