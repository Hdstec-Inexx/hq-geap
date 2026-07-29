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

As configurações locais possuem valores padrão compatíveis com `compose.yaml`. Para sobrescrevê-las, use as variáveis documentadas em `.env.example`.

## Verificações

Com o banco do Compose ativo:

```bash
pnpm typecheck
pnpm db:validate
pnpm exec playwright install chromium
pnpm test
```

`db:validate` aplica migration e seed dentro de uma transação isolada e confirma que a Régua inicial contém sete Critérios ativos somando exatamente 10, além de uma configuração ativa da IA Avaliadora.
