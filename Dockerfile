# syntax=docker/dockerfile:1
# Imagem da API. No Easypanel use este arquivo no App hq-api (porta 3000).

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @hq-geap/api...

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY scripts scripts
COPY db db
RUN pnpm --filter @hq-geap/contracts build \
  && pnpm --filter @hq-geap/api build \
  && pnpm exec tsc \
    --module NodeNext \
    --moduleResolution NodeNext \
    --target ES2022 \
    --outDir scripts-dist \
    --rootDir scripts \
    --esModuleInterop \
    --skipLibCheck \
    scripts/database.ts \
    scripts/environment.ts

FROM base AS api
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter @hq-geap/api... \
  && addgroup -S hq && adduser -S -G hq hq
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/scripts-dist scripts
COPY --from=build /app/db db
COPY docker/api-entrypoint.sh /app/docker/api-entrypoint.sh
RUN chmod +x /app/docker/api-entrypoint.sh \
  && node /app/scripts/database.js >/tmp/database-cli.txt 2>&1 || true \
  && grep -q 'Usage:' /tmp/database-cli.txt \
  && rm /tmp/database-cli.txt \
  && chown -R hq:hq /app
USER hq
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker/api-entrypoint.sh"]
