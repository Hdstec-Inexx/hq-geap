import type { FastifyBaseLogger } from 'fastify';
import fp from 'fastify-plugin';
import type pg from 'pg';
import {
  REPROCESSAMENTO_LOCK_ID,
  REPROCESSAMENTO_LOTE_PADRAO,
  runPass,
  type RunPassOptions
} from '../modules/atendimentos/reprocessamento.js';

export { REPROCESSAMENTO_LOCK_ID };

export interface ReprocessamentoCycleResult {
  executed: boolean;
  locked: boolean;
  processed: number;
  success: number;
  failed: number;
  error?: string;
}

export interface ReprocessamentoLogger {
  info?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface ExecuteReprocessamentoOptions {
  lockId?: number;
  apiUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  limit?: number;
  log?: ReprocessamentoLogger;
  reprocessFn?: (
    options?: RunPassOptions
  ) => Promise<{ processed: number; success: number; failed: number }>;
}

export async function executeReprocessamentoCycle(
  db: pg.Pool,
  options?: ExecuteReprocessamentoOptions
): Promise<ReprocessamentoCycleResult> {
  const lockId = options?.lockId ?? REPROCESSAMENTO_LOCK_ID;
  const logger = options?.log ?? console;
  const reprocessFn = options?.reprocessFn ?? runPass;

  let lockClient: pg.PoolClient | null = null;
  let lockAcquired = false;

  try {
    lockClient = await db.connect();
    await lockClient.query('begin');

    const lockResult = await lockClient.query<{ acquired: boolean }>(
      'select pg_try_advisory_xact_lock($1) as acquired',
      [lockId]
    );

    lockAcquired = lockResult.rows[0]?.acquired === true;

    if (!lockAcquired) {
      await lockClient.query('rollback');
      lockClient.release();
      lockClient = null;

      logger.info?.(
        `[reprocessamento] Ciclo ignorado: lock consultivo (${lockId}) em uso por outra réplica.`
      );
      return {
        executed: false,
        locked: false,
        processed: 0,
        success: 0,
        failed: 0
      };
    }

    logger.info?.(
      `[reprocessamento] Lock consultivo (${lockId}) adquirido. Executando lote de reprocessamento...`
    );

    const batchResult = await reprocessFn({
      apiUrl: options?.apiUrl,
      apiKey: options?.apiKey,
      fetchFn: options?.fetchFn,
      limit: options?.limit ?? REPROCESSAMENTO_LOTE_PADRAO,
      dbClient: db
    });

    await lockClient.query('commit');

    logger.info?.(
      `[reprocessamento] Lote concluído: ${batchResult.success}/${batchResult.processed} processados com sucesso (${batchResult.failed} falhas).`
    );

    return {
      executed: true,
      locked: true,
      processed: batchResult.processed,
      success: batchResult.success,
      failed: batchResult.failed
    };
  } catch (error) {
    if (lockClient) {
      try {
        await lockClient.query('rollback');
      } catch {
        // ignora falha secundária de rollback
      }
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error?.(
      `[reprocessamento] Erro durante o ciclo de reprocessamento: ${errorMessage}`
    );
    return {
      executed: false,
      locked: lockAcquired,
      processed: 0,
      success: 0,
      failed: 0,
      error: errorMessage
    };
  } finally {
    if (lockClient) {
      try {
        lockClient.release();
      } catch {
        // ignora se já foi liberado
      }
    }
  }
}

export interface ReprocessamentoPluginOptions {
  enabled?: boolean;
  intervalMinutes?: number;
  runImmediately?: boolean;
  lockId?: number;
  limit?: number;
  reprocessFn?: (
    options?: RunPassOptions
  ) => Promise<{ processed: number; success: number; failed: number }>;
}

export interface ReprocessamentoService {
  runCycle: () => Promise<ReprocessamentoCycleResult>;
  isRunning: () => boolean;
  stop: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    reprocessamentoTranscricao?: ReprocessamentoService;
  }
}

export default fp<ReprocessamentoPluginOptions>(
  async (app, options) => {
    const enabled =
      options?.enabled ??
      app.config.AUTO_REPROCESS_TRANSCRICOES;

    const intervalMinutes =
      options?.intervalMinutes ??
      app.config.REPROCESSAMENTO_TRANSCRICAO_INTERVALO_MINUTOS ??
      10;

    const runImmediately = options?.runImmediately ?? true;
    const intervalMs = Math.max(1000, intervalMinutes * 60 * 1000);
    const lockId = options?.lockId ?? REPROCESSAMENTO_LOCK_ID;

    let timer: NodeJS.Timeout | null = null;
    let activeCyclePromise: Promise<ReprocessamentoCycleResult> | null = null;
    let isClosing = false;

    async function runCycle(): Promise<ReprocessamentoCycleResult> {
      if (isClosing) {
        return {
          executed: false,
          locked: false,
          processed: 0,
          success: 0,
          failed: 0
        };
      }

      if (activeCyclePromise) {
        return activeCyclePromise;
      }

      activeCyclePromise = (async () => {
        try {
          return await executeReprocessamentoCycle(app.db, {
            lockId,
            apiUrl: app.config.ELEVENLABS_API_URL,
            apiKey: app.config.ELEVENLABS_API_KEY,
            limit: options?.limit,
            log: app.log,
            reprocessFn: options?.reprocessFn
          });
        } finally {
          activeCyclePromise = null;
        }
      })();

      return activeCyclePromise;
    }

    async function stop(): Promise<void> {
      isClosing = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (activeCyclePromise) {
        try {
          await activeCyclePromise;
        } catch {
          // ignora erro durante encerramento gracioso
        }
      }
    }

    app.decorate('reprocessamentoTranscricao', {
      runCycle,
      isRunning: () => activeCyclePromise !== null,
      stop
    });

    if (enabled) {
      app.addHook('onReady', async () => {
        if (isClosing) return;

        if (runImmediately) {
          setImmediate(() => {
            void runCycle().catch((err) => {
              app.log.error(
                err,
                '[reprocessamento] Erro no disparo imediato onReady'
              );
            });
          });
        }

        timer = setInterval(() => {
          void runCycle().catch((err) => {
            app.log.error(err, '[reprocessamento] Erro no ciclo agendado');
          });
        }, intervalMs);

        if (timer.unref) {
          timer.unref();
        }
      });
    }

    app.addHook('onClose', async () => {
      await stop();
    });
  },
  { name: 'reprocessamentoTranscricao', dependencies: ['config', 'database'] }
);
