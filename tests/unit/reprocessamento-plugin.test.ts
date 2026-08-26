import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import type pg from 'pg';
import { parseAppConfig } from '../../apps/api/src/plugins/config.js';
import {
  executeReprocessamentoCycle,
  REPROCESSAMENTO_LOCK_ID
} from '../../apps/api/src/plugins/reprocessamento-transcricao.js';
import { buildApp } from '../../apps/api/src/app.js';
import { withTestDatabaseLock } from '../support/test-db.js';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));

test('config schema define intervalo padrao de 10 minutos para reprocessamento', () => {
  const config = parseAppConfig({
    DATABASE_URL: 'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap'
  });
  assert.equal(config.REPROCESSAMENTO_TRANSCRICAO_INTERVALO_MINUTOS, 10);
});

test('config schema aceita REPROCESSAMENTO_TRANSCRICAO_INTERVALO_MINUTOS customizado', () => {
  const config = parseAppConfig({
    DATABASE_URL: 'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap',
    REPROCESSAMENTO_TRANSCRICAO_INTERVALO_MINUTOS: '15'
  });
  assert.equal(config.REPROCESSAMENTO_TRANSCRICAO_INTERVALO_MINUTOS, 15);
});

test('config schema parseia AUTO_REPROCESS_TRANSCRICOES boolean e string', () => {
  const configOff = parseAppConfig({
    DATABASE_URL: 'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap',
    AUTO_REPROCESS_TRANSCRICOES: 'false'
  });
  assert.equal(configOff.AUTO_REPROCESS_TRANSCRICOES, false);

  const configOn = parseAppConfig({
    DATABASE_URL: 'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap',
    AUTO_REPROCESS_TRANSCRICOES: 'true'
  });
  assert.equal(configOn.AUTO_REPROCESS_TRANSCRICOES, true);
});

test('executeReprocessamentoCycle adquire lock consultivo pg_try_advisory_xact_lock e executa lote', async () => {
  const queriesExecuted: string[] = [];
  let clientReleased = false;
  let reprocessFnCalled = false;

  const mockClient = {
    query: async (text: string, _values?: unknown[]) => {
      queriesExecuted.push(text.trim());
      if (text.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      clientReleased = true;
    }
  } as unknown as pg.PoolClient;

  const mockPool = {
    connect: async () => mockClient
  } as unknown as pg.Pool;

  const mockReprocessFn = async () => {
    reprocessFnCalled = true;
    return { processed: 2, success: 2, failed: 0 };
  };

  const result = await executeReprocessamentoCycle(mockPool, {
    lockId: REPROCESSAMENTO_LOCK_ID,
    reprocessFn: mockReprocessFn
  });

  assert.equal(result.executed, true);
  assert.equal(result.locked, true);
  assert.equal(result.processed, 2);
  assert.equal(result.success, 2);
  assert.equal(result.failed, 0);
  assert.equal(reprocessFnCalled, true);
  assert.equal(clientReleased, true);

  assert.equal(queriesExecuted[0], 'begin');
  assert.ok(queriesExecuted[1]?.includes('pg_try_advisory_xact_lock'));
  assert.equal(queriesExecuted[2], 'commit');
});

test('executeReprocessamentoCycle pula execucao se lock consultivo estiver ocupado por outra replica', async () => {
  const queriesExecuted: string[] = [];
  let clientReleased = false;
  let reprocessFnCalled = false;

  const mockClient = {
    query: async (text: string) => {
      queriesExecuted.push(text.trim());
      if (text.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      clientReleased = true;
    }
  } as unknown as pg.PoolClient;

  const mockPool = {
    connect: async () => mockClient
  } as unknown as pg.Pool;

  const mockReprocessFn = async () => {
    reprocessFnCalled = true;
    return { processed: 10, success: 10, failed: 0 };
  };

  const result = await executeReprocessamentoCycle(mockPool, {
    lockId: REPROCESSAMENTO_LOCK_ID,
    reprocessFn: mockReprocessFn
  });

  assert.equal(result.executed, false);
  assert.equal(result.locked, false);
  assert.equal(result.processed, 0);
  assert.equal(reprocessFnCalled, false);
  assert.equal(clientReleased, true);

  assert.equal(queriesExecuted[0], 'begin');
  assert.ok(queriesExecuted[1]?.includes('pg_try_advisory_xact_lock'));
  assert.equal(queriesExecuted[2], 'rollback');
});

test('executeReprocessamentoCycle trata erro durante o ciclo e realiza rollback com release do cliente', async () => {
  const queriesExecuted: string[] = [];
  let clientReleased = false;

  const mockClient = {
    query: async (text: string) => {
      queriesExecuted.push(text.trim());
      if (text.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      clientReleased = true;
    }
  } as unknown as pg.PoolClient;

  const mockPool = {
    connect: async () => mockClient
  } as unknown as pg.Pool;

  const mockReprocessFn = async () => {
    throw new Error('Falha simulada no lote');
  };

  const result = await executeReprocessamentoCycle(mockPool, {
    lockId: REPROCESSAMENTO_LOCK_ID,
    reprocessFn: mockReprocessFn
  });

  assert.equal(result.executed, false);
  assert.equal(result.locked, true);
  assert.equal(result.error, 'Falha simulada no lote');
  assert.equal(clientReleased, true);
  assert.ok(queriesExecuted.includes('rollback'));
});

test('plugin fastify dispara execucao imediata onReady e agenda intervalo configurado', async () => {
  let cycleCount = 0;

  const app = await buildApp({
    reprocessamento: {
      enabled: true,
      runImmediately: true,
      intervalMinutes: 10,
      reprocessFn: async () => {
        cycleCount++;
        return { processed: 1, success: 1, failed: 0 };
      }
    }
  });

  assert.ok(app.reprocessamentoTranscricao);
  assert.equal(typeof app.reprocessamentoTranscricao.runCycle, 'function');

  await app.ready();

  // Aguarda disparo assíncrono do setImmediate e conexão com banco
  const startWait = Date.now();
  while (cycleCount === 0 && Date.now() - startWait < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.ok(cycleCount >= 1, 'Deveria ter disparado pelo menos o ciclo imediato no onReady');

  await app.close();
});

test('plugin fastify respeita enabled=false e nao agenda nem executa no onReady', async () => {
  let cycleCount = 0;

  const app = await buildApp({
    reprocessamento: {
      enabled: false,
      reprocessFn: async () => {
        cycleCount++;
        return { processed: 1, success: 1, failed: 0 };
      }
    }
  });

  await app.ready();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(cycleCount, 0, 'Nao deveria ter executado quando enabled=false');

  await app.close();
});

test('plugin fastify realiza graceful shutdown no onClose limpando timers sem travar', async () => {
  let isExecuting = false;
  let finished = false;

  const app = await buildApp({
    reprocessamento: {
      enabled: true,
      runImmediately: true,
      reprocessFn: async () => {
        isExecuting = true;
        await new Promise((resolve) => setTimeout(resolve, 80));
        finished = true;
        isExecuting = false;
        return { processed: 1, success: 1, failed: 0 };
      }
    }
  });

  await app.ready();

  const startWait = Date.now();
  while (!isExecuting && Date.now() - startWait < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Encerra a aplicação enquanto o ciclo está em andamento
  await app.close();

  assert.equal(finished, true, 'Deveria aguardar o ciclo em andamento finalizar');
  assert.equal(isExecuting, false);
});

test('controle de concorrencia com pg_try_advisory_xact_lock impede execucao simultanea em banco real', async () => {
  await withTestDatabaseLock(async () => {
    const connectionString =
      process.env.TEST_DATABASE_URL ??
      'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';

    const pgModule = apiRequire('pg') as typeof import('pg');
    const pool = new pgModule.Pool({ connectionString });

    try {
      let replica1Ran = false;
      let replica2Ran = false;

      let signalReplica1Started!: () => void;
      const replica1Started = new Promise<void>((resolve) => {
        signalReplica1Started = resolve;
      });

      let signalReplica1CanFinish!: () => void;
      const replica1CanFinish = new Promise<void>((resolve) => {
        signalReplica1CanFinish = resolve;
      });

      // Replica 1 inicia e segura o lock até sinalização
      const replica1Promise = executeReprocessamentoCycle(pool, {
        lockId: 90421,
        reprocessFn: async () => {
          replica1Ran = true;
          signalReplica1Started();
          await replica1CanFinish;
          return { processed: 5, success: 5, failed: 0 };
        }
      });

      // Aguarda Replica 1 de fato adquirir o lock no PostgreSQL
      await replica1Started;

      // Replica 2 tenta executar concorrentemente com o lock retido pela Replica 1
      const res2 = await executeReprocessamentoCycle(pool, {
        lockId: 90421,
        reprocessFn: async () => {
          replica2Ran = true;
          return { processed: 5, success: 5, failed: 0 };
        }
      });

      // Libera a Replica 1 para concluir e commitar a transação
      signalReplica1CanFinish();
      const res1 = await replica1Promise;

      assert.equal(res1.locked, true, 'Replica 1 deveria adquirir o lock');
      assert.equal(res1.executed, true, 'Replica 1 deveria executar o lote');
      assert.equal(replica1Ran, true);

      assert.equal(res2.locked, false, 'Replica 2 nao deveria adquirir o lock concorrente');
      assert.equal(res2.executed, false, 'Replica 2 deveria ignorar execucao concorrente');
      assert.equal(replica2Ran, false, 'Replica 2 nao deveria chamar o reprocessFn');
    } finally {
      await pool.end();
    }
  });
});

test('buildApp registra o plugin de reprocessamentoTranscricao na aplicacao Fastify', async () => {
  const app = await buildApp({
    reprocessamento: {
      enabled: false
    }
  });

  assert.ok(app.reprocessamentoTranscricao, 'Plugin reprocessamentoTranscricao deve estar decorado');
  assert.equal(typeof app.reprocessamentoTranscricao.runCycle, 'function');
  assert.equal(typeof app.reprocessamentoTranscricao.stop, 'function');

  await app.close();
});
