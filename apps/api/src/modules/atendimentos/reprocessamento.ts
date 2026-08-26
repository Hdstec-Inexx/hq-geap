import pg from 'pg';
import {
  transformToHistoricoTranscricao,
  extractCallDuration,
  calculateTempoEspera,
  type HistoricoTranscricao
} from '@hq-geap/contracts/atendimentos';

const { Client } = pg;

export interface DatabaseQueryable {
  query<T = unknown>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface ReprocessamentoLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface ReprocessOptions {
  apiUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  log?: ReprocessamentoLogger;
}

export interface RunPassOptions extends ReprocessOptions {
  specificIds?: string[];
  force?: boolean;
  dbClient?: pg.Pool | pg.PoolClient | pg.Client | DatabaseQueryable;
  limit?: number;
}

export const REPROCESSAMENTO_MAX_TENTATIVAS = 3;
export const REPROCESSAMENTO_DATA_CORTE = '2026-08-19';
export const REPROCESSAMENTO_LOTE_PADRAO = 50;
export const REPROCESSAMENTO_LOCK_ID = 90420;

function assertSafeSqlIdentifier(identifier: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(identifier)) {
    throw new Error(`Identificador SQL inválido: ${identifier}`);
  }
}

export function buildInconsistentTranscriptionSqlPredicate(
  columnName = 'transcricao'
): string {
  assertSafeSqlIdentifier(columnName);

  const arrayExpr = `case
    when jsonb_typeof(${columnName}) = 'array' then ${columnName}
    when jsonb_typeof(${columnName}->'historico') = 'array' then ${columnName}->'historico'
    when jsonb_typeof(${columnName}->'transcript') = 'array' then ${columnName}->'transcript'
    when jsonb_typeof(${columnName}->'data'->'transcript') = 'array' then ${columnName}->'data'->'transcript'
    else '[]'::jsonb
  end`;

  return `(
    ${columnName} is null
    or jsonb_typeof(${columnName}) not in ('array', 'object')
    or jsonb_array_length(${arrayExpr}) = 0
    or (
      select count(1)
      from jsonb_array_elements(${arrayExpr}) as elem
      where case
        when trim(elem->>'time_in_call_secs') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          then (trim(elem->>'time_in_call_secs'))::numeric <= 0
        when trim(elem->>'tempo_segundos') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          then (trim(elem->>'tempo_segundos'))::numeric <= 0
        else true
      end
    ) > 1
  )`.trim();
}

export function findInconsistentConversationIdsQuery(options?: {
  force?: boolean;
  tableAlias?: string;
}): string {
  if (options?.tableAlias) {
    assertSafeSqlIdentifier(options.tableAlias);
  }

  const col = options?.tableAlias
    ? `${options.tableAlias}.transcricao`
    : 'transcricao';
  const table = options?.tableAlias
    ? `atendimentos ${options.tableAlias}`
    : 'atendimentos';
  const prefix = options?.tableAlias ? `${options.tableAlias}.` : '';

  const baseConditions = `
    ${prefix}status = 'concluido'
    and not ${prefix}reprocessamento_ignorado
    and ${prefix}reprocessamento_tentativas < ${REPROCESSAMENTO_MAX_TENTATIVAS}
    and ${prefix}concluido_em < '${REPROCESSAMENTO_DATA_CORTE}'
  `.trim();

  if (options?.force) {
    return `
      select ${prefix}elevenlabs_conversation_id as "conversationId"
      from ${table}
      where ${baseConditions}
      order by ${prefix}concluido_em asc
      limit $1
    `.trim();
  }

  const predicate = buildInconsistentTranscriptionSqlPredicate(col);

  return `
    select ${prefix}elevenlabs_conversation_id as "conversationId"
    from ${table}
    where ${baseConditions}
      and ${predicate}
    order by ${prefix}concluido_em asc
    limit $1
  `.trim();
}

export type ElevenLabsFetchOutcome = {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  error?: string;
};

export async function fetchElevenLabsConversationDetail(
  conversationId: string,
  options?: ReprocessOptions
): Promise<ElevenLabsFetchOutcome> {
  const baseUrl = (
    options?.apiUrl ??
    process.env.ELEVENLABS_API_URL ??
    'https://api.elevenlabs.io'
  ).replace(/\/$/, '');
  const apiKey = options?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  const fetchFn = options?.fetchFn ?? fetch;

  const url = `${baseUrl}/v1/convai/conversations/${encodeURIComponent(conversationId)}`;
  const headers: Record<string, string> = {
    accept: 'application/json'
  };
  if (apiKey) {
    headers['xi-api-key'] = apiKey;
  }

  try {
    const response = await fetchFn(url, { headers });
    if (response.status === 404) {
      return {
        ok: false,
        status: 404,
        data: null,
        error: '404 Not Found'
      };
    }
    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText || 'Error'}`;
      return {
        ok: false,
        status: response.status,
        data: null,
        error: errorMsg
      };
    }
    const data = (await response.json()) as Record<string, unknown>;
    return {
      ok: true,
      status: response.status,
      data
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(
      `  [aviso] Falha na requisição ElevenLabs para ${conversationId}:`,
      errorMsg
    );
    return {
      ok: false,
      status: 0,
      data: null,
      error: errorMsg || 'Network error'
    };
  }
}

export async function fetchElevenLabsConversation(
  conversationId: string,
  options?: ReprocessOptions
): Promise<Record<string, unknown> | null> {
  const result = await fetchElevenLabsConversationDetail(conversationId, options);
  return result.ok ? result.data : null;
}

export interface ReprocessOutcome {
  conversationId: string;
  success: boolean;
  ignored?: boolean;
  error?: string;
}

function isPool(db: unknown): db is pg.Pool {
  return (
    db !== null &&
    typeof db === 'object' &&
    'connect' in db &&
    typeof (db as { connect?: unknown }).connect === 'function' &&
    'totalCount' in db &&
    typeof (db as { totalCount?: unknown }).totalCount === 'number'
  );
}

async function withClient<T>(
  db: DatabaseQueryable | pg.Pool,
  fn: (client: DatabaseQueryable) => Promise<T>
): Promise<T> {
  if (isPool(db)) {
    const client = await db.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
  return fn(db);
}

async function persistReprocessError(
  db: DatabaseQueryable | pg.Pool,
  conversationId: string,
  options: { is404: boolean; errorMessage: string }
): Promise<void> {
  const updateClause = options.is404
    ? 'reprocessamento_ignorado = true'
    : 'reprocessamento_tentativas = reprocessamento_tentativas + 1';

  try {
    await withClient(db, async (client) => {
      await client.query(
        `
        update atendimentos
        set ${updateClause},
            reprocessamento_ultimo_erro = $1,
            atualizado_em = now()
        where elevenlabs_conversation_id = $2
          and status = 'concluido'
      `,
        [options.errorMessage, conversationId]
      );
    });
  } catch (dbError) {
    const action = options.is404 ? 'marcar 404' : 'registrar erro transitório';
    console.warn(
      `  [aviso] Falha ao ${action} no banco para ${conversationId}:`,
      dbError
    );
  }
}

export async function reprocessAtendimento(
  db: DatabaseQueryable | pg.Pool,
  conversationId: string,
  options?: ReprocessOptions
): Promise<ReprocessOutcome> {
  const fetchResult = await fetchElevenLabsConversationDetail(
    conversationId,
    options
  );

  if (!fetchResult.ok || !fetchResult.data) {
    const is404 = fetchResult.status === 404;
    const errorMsg = is404
      ? '404 Not Found'
      : fetchResult.error ?? 'Falha de comunicação com ElevenLabs';

    await persistReprocessError(db, conversationId, {
      is404,
      errorMessage: errorMsg
    });

    return {
      conversationId,
      success: false,
      ...(is404 ? { ignored: true } : {}),
      error: errorMsg
    };
  }

  const conversationData = fetchResult.data;
  const historicoTranscricao = transformToHistoricoTranscricao(conversationData);
  const serialized = JSON.stringify(historicoTranscricao);
  const duracaoSegundos = extractCallDuration(conversationData);
  const tempoEsperaSegundos = calculateTempoEspera(conversationData);

  return withClient(db, async (client) => {
    await client.query('begin');
    try {
      const result = await client.query(
        `
        update atendimentos
        set transcricao = $1::jsonb,
            duracao_segundos = $2,
            tme_segundos = $3,
            reprocessamento_tentativas = 0,
            reprocessamento_ignorado = false,
            reprocessamento_ultimo_erro = null,
            atualizado_em = now()
        where elevenlabs_conversation_id = $4
          and status = 'concluido'
      `,
        [serialized, duracaoSegundos, tempoEsperaSegundos, conversationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return {
          conversationId,
          success: false,
          error: `Atendimento concluído com elevenlabs_conversation_id=${conversationId} não encontrado no banco`
        };
      }

      await client.query('commit');
      return { conversationId, success: true };
    } catch (error) {
      await client.query('rollback');
      return {
        conversationId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

export const reprocessConversation = reprocessAtendimento;
export const fetchElevenLabsTranscript = fetchElevenLabsConversation;

export async function runPass(
  options?: RunPassOptions
): Promise<{ processed: number; success: number; failed: number }> {
  const logger = options?.log ?? console;
  let db: DatabaseQueryable | pg.Pool;
  let shouldCloseDb = false;

  if (options?.dbClient) {
    db = options.dbClient;
  } else {
    const databaseUrl =
      process.env.DATABASE_URL ??
      'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap';
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    db = client;
    shouldCloseDb = true;
  }

  try {
    let conversationIds: string[] = [];

    if (options?.specificIds && options.specificIds.length > 0) {
      conversationIds = options.specificIds;
    } else {
      const effectiveLimit = Math.max(
        1,
        Math.trunc(Number(options?.limit) || REPROCESSAMENTO_LOTE_PADRAO)
      );
      const queryText = findInconsistentConversationIdsQuery({
        force: options?.force
      });
      const queryable: DatabaseQueryable = db;
      const result = await queryable.query<{ conversationId: string }>(queryText, [
        effectiveLimit
      ]);
      conversationIds = result.rows.map((row: { conversationId: string }) => row.conversationId);
    }

    if (conversationIds.length === 0) {
      logger.info?.(
        `[${new Date().toISOString()}] Nenhuma transcrição inconsistente pendente de reprocessamento.`
      );
      return { processed: 0, success: 0, failed: 0 };
    }

    logger.info?.(
      `[${new Date().toISOString()}] Reprocessando transcrições de ${conversationIds.length} atendimento(s)...`
    );

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < conversationIds.length; i++) {
      const conversationId = conversationIds[i]!;
      const outcome = await reprocessAtendimento(db, conversationId, {
        apiUrl: options?.apiUrl,
        apiKey: options?.apiKey,
        fetchFn: options?.fetchFn,
        log: options?.log
      });

      if (outcome.success) {
        successCount++;
        logger.info?.(
          `  ✓ [${i + 1}/${conversationIds.length}] Transcrição atualizada: ${conversationId}`
        );
      } else if (outcome.ignored) {
        failedCount++;
        logger.warn?.(
          `  ⚠ [${i + 1}/${conversationIds.length}] Atendimento descartado (404): ${conversationId}`
        );
      } else {
        failedCount++;
        logger.error?.(
          `  ✗ [${i + 1}/${conversationIds.length}] Erro em ${conversationId}: ${outcome.error}`
        );
      }
    }

    logger.info?.(
      `[${new Date().toISOString()}] Concluído: ${successCount}/${conversationIds.length} transcrições reprocessadas com sucesso (${failedCount} falhas).`
    );

    return {
      processed: conversationIds.length,
      success: successCount,
      failed: failedCount
    };
  } finally {
    if (shouldCloseDb && 'end' in db && typeof (db as { end?: unknown }).end === 'function') {
      await (db as { end: () => Promise<void> }).end();
    }
  }
}
