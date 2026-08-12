# Deploy no Easypanel (VPS)

O HQ GEAP sobe como **dois App services** (API + Web) e conecta a um **PostgreSQL já provisionado** via `DATABASE_URL`. As rotas da API e da UI compartilham paths (`/atendimentos`, `/curadoria`, …), então não dá para servir os dois no mesmo host/porta sem prefixo `/api`.

`compose.yaml` continua só para desenvolvimento local. Produção usa:

- `Dockerfile` → API (usuário não-root, deps de produção)
- `Dockerfile.web` → interface (nginx unprivileged)
- `compose.easypanel.yaml` → alternativa Compose no painel

## Serviços no painel

1. **PostgreSQL** já provisionado (Database do Easypanel ou outro host acessível pela rede do Compose)
2. **hq-api** (App → `Dockerfile`, porta `3015`) — conecta só via `DATABASE_URL`
3. **hq-web** (App → `Dockerfile.web`, porta `8025`)
4. Storage: MinIO com HTTPS público **ou** GCS (`STORAGE_PROVIDER=gcs`)
5. **n8n** continua separado (Credentials próprias; ver `docs/n8n/credentials.md`)

## App `hq-api`

- Source: repositório Git, branch de deploy, Build Path `/`
- Build: Dockerfile, path `Dockerfile`
- Domínio: ex. `https://api.seudominio.com` → porta interna `3015`
- Environment (exemplo):

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3015
DATABASE_URL=postgres://USER:PASSWORD@NOME_DO_SERVICO_DB:5432/hq_geap
CORS_ORIGIN=https://hq.seudominio.com
JWT_SECRET=troque-por-segredo-com-pelo-menos-32-chars
INGESTION_API_KEY=troque-por-chave-com-pelo-menos-32-chars
ELEVENLABS_API_KEY=sk_...
STORAGE_PROVIDER=minio
STORAGE_BUCKET=hq-geap-audio
STORAGE_ENDPOINT=https://minio.seudominio.com
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_PUBLIC_URL=https://minio.seudominio.com/hq-geap-audio
```

O entrypoint valida a config de produção, aplica `migrate` e, por padrão, `seed` antes de subir a API. O seed é idempotente e cria o Admin `admin@hq.local` / `senha-admin` se ainda não houver Admin ativo — **troque a senha no primeiro acesso**. Depois do primeiro deploy, defina `SKIP_DB_SEED=1` para não reexecutar seeds a cada restart.

Em produção, se `HOST` não for definido, a API escuta em `0.0.0.0` (necessário para o proxy do Easypanel).

### GCS (opcional)

Com `STORAGE_PROVIDER=gcs`, o bucket deve existir e a API precisa de credenciais ADC (ex.: monte o JSON da service account e aponte `GOOGLE_APPLICATION_CREDENTIALS` para o path dentro do container). `STORAGE_BUCKET` e `STORAGE_PUBLIC_URL` continuam obrigatórios.

## App `hq-web`

- Build: Dockerfile path `Dockerfile.web`
- Environment / build arg: `VITE_API_URL=https://api.seudominio.com` (URL pública da API, sem barra final). O Easypanel injeta envs do serviço como build args.
- Domínio: ex. `https://hq.seudominio.com` → porta interna `8025`

Rebuild a Web sempre que mudar `VITE_API_URL` (é embutida no bundle Vite).

O `index.html` da Web é deliberadamente servido com `Cache-Control: no-store`;
ele aponta para assets JS/CSS com hash e não pode ficar persistido entre
deploys. Depois de publicar uma nova imagem, confirme que a resposta de `/`
tem `Cache-Control: no-store` e que referencia o novo asset em `/assets/`.
Os assets versionados podem permanecer cacheados por serem imutáveis.

## Compose no Easypanel (alternativa)

1. Serviço **Compose** com arquivo `compose.easypanel.yaml` (só `api` + `web`; sem Postgres no Compose)
2. Preencha as variáveis exigidas — modelo completo em `compose.easypanel.env.example` (`DATABASE_URL` do DB externo, `CORS_ORIGIN`, secrets, storage, `VITE_API_URL`, …)
3. Domains do painel:
   - API → serviço interno `api`, porta `3015`
   - Web → serviço interno `web`, porta `8025`
4. Não publique `ports` no host para HTTP; o proxy do Easypanel resolve isso

## Checklist pós-deploy

- [ ] `GET https://api.seudominio.com/health` responde OK
- [ ] `GET https://hq.seudominio.com/` responde com `Cache-Control: no-store`
- [ ] O HTML publicado referencia o asset JS gerado no último build
- [ ] Login em `https://hq.seudominio.com/login`
- [ ] Senha do Admin inicial alterada
- [ ] `SKIP_DB_SEED=1` após o primeiro seed (recomendado)
- [ ] n8n aponta ingestão para a API com `x-ingestion-key`
- [ ] Áudio acessível via storage assinado (não use `STORAGE_PROVIDER=public` em produção)

## API `unhealthy` no Compose

O entrypoint **valida a config antes** de migrate/seed. Se faltar variável (ou `STORAGE_PROVIDER=public`, secrets com menos de 32 caracteres, MinIO sem HTTPS), o container reinicia e o healthcheck falha — o `web` não sobe (`depends_on: service_healthy`).

1. `docker logs <api-container> --tail 100` — procure `Invalid API config`
2. Confira no painel **todas** as envs do bloco `hq-api` acima (não basta `DATABASE_URL` + `ELEVENLABS_API_KEY`)
3. `JWT_SECRET` e `INGESTION_API_KEY`: mínimo 32 caracteres (não use os defaults de desenvolvimento)
4. `STORAGE_PROVIDER`: `minio` ou `gcs` — nunca `public` em produção
5. Com MinIO: `STORAGE_ENDPOINT` em **HTTPS** + access/secret keys + `STORAGE_PUBLIC_URL`
6. `DATABASE_URL` deve apontar para o PostgreSQL externo (hostname na rede do Easypanel / host do DB), não `127.0.0.1` nem um serviço `db` deste Compose
