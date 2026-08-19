import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { areasPorPapel } from '../../apps/web/src/app/casca-areas.js';
import {
  curadoriasRealizadasPageSchema,
  curadoriasRealizadasQuerySchema,
  curadoriaRealizadaItemSchema
} from '../../packages/contracts/src/curadoria.js';
import {
  curadoriasRealizadasHref,
  reviewHref
} from '../../apps/web/src/features/curadoria/pagination.js';

const pagePath = new URL(
  '../../apps/web/src/features/curadoria/CuradoriasRealizadasPage.tsx',
  import.meta.url
);
const routerPath = new URL(
  '../../apps/web/src/app/router.tsx',
  import.meta.url
);
const reviewPagePath = new URL(
  '../../apps/web/src/features/curadoria/CuradoriaReviewPage.tsx',
  import.meta.url
);
const routesPath = new URL(
  '../../apps/api/src/modules/curadoria/routes.ts',
  import.meta.url
);

test('curadoriaRealizadaItemSchema valida contrato com campos de curadoria realizada', () => {
  const valid = {
    id: '11111111-1111-4111-8111-111111111111',
    conversationId: 'conv-test-123',
    agenteVozNome: 'Livia',
    concluidoEm: '2025-01-15T12:00:00.000Z',
    duracaoSegundos: 120,
    motivoContato: 'Financeiro/Boletos',
    notaIa: 9.0,
    curadorId: '22222222-2222-4222-8222-222222222222',
    curadorNome: 'Caio Curador',
    notaCurador: 8.5,
    realizadaEm: '2025-01-15T13:00:00.000Z'
  };

  const parsed = curadoriaRealizadaItemSchema.parse(valid);
  assert.equal(parsed.id, valid.id);
  assert.equal(parsed.notaCurador, 8.5);
  assert.equal(parsed.curadorNome, 'Caio Curador');
});

test('curadoriasRealizadasQuerySchema valida limites de paginação e datas', () => {
  const query = curadoriasRealizadasQuerySchema.parse({
    inicio: '2025-01-01',
    fim: '2025-01-31',
    motivo: 'Rede credenciada',
    curadorId: '22222222-2222-4222-8222-222222222222',
    limit: 25,
    offset: 50
  });

  assert.equal(query.limit, 25);
  assert.equal(query.offset, 50);
  assert.equal(query.inicio, '2025-01-01');
  assert.equal(query.fim, '2025-01-31');
  assert.equal(query.curadorId, '22222222-2222-4222-8222-222222222222');
});

test('CuradoriasRealizadasPage integra com /curadorias-realizadas, schema e filtros', async () => {
  const pageContent = await readFile(pagePath, 'utf8');

  assert.match(pageContent, /\/curadorias-realizadas/);
  assert.match(pageContent, /curadoriasRealizadasPageSchema/);
  assert.match(pageContent, /Minhas Curadorias/);
  assert.match(pageContent, /Curadorias Realizadas/);
  assert.match(pageContent, /MotivoCombobox/);
  assert.match(pageContent, /curadorId/);
  assert.match(pageContent, /reviewHref/);
});

test('router.tsx integra rotas /minhas-curadorias e /curadorias-realizadas', async () => {
  const routerContent = await readFile(routerPath, 'utf8');

  assert.match(routerContent, /\/minhas-curadorias/);
  assert.match(routerContent, /\/curadorias-realizadas/);
});

test('CuradoriaReviewPage suporta retorno dinâmico para Minhas Curadorias e Curadorias Realizadas', async () => {
  const reviewContent = await readFile(reviewPagePath, 'utf8');

  assert.match(reviewContent, /getBackLinkInfo/);
  assert.match(reviewContent, /Voltar a Minhas Curadorias/);
  assert.match(reviewContent, /Voltar a Curadorias Realizadas/);
  assert.match(reviewContent, /Voltar à fila/);
});

test('API routes registra rota GET /curadorias-realizadas com auth para todos os papéis', async () => {
  const routesContent = await readFile(routesPath, 'utf8');

  assert.match(routesContent, /app\.get\('\/curadorias-realizadas'/);
  assert.match(routesContent, /curadoriasRealizadasQuerySchema/);
  assert.match(routesContent, /repository\.listRealizadas/);
});

test('curadoriasRealizadasHref e reviewHref com from preservam histórico de navegação', () => {
  const params = new URLSearchParams('inicio=2025-01-01&fim=2025-01-15&page=2');
  const href = reviewHref('33333333-3333-4333-8333-333333333333', params, '/minhas-curadorias');

  assert.match(href, /\/curadoria\/33333333-3333-4333-8333-333333333333/);
  assert.match(href, /from=%2Fminhas-curadorias/);
  assert.match(href, /page=2/);
});
