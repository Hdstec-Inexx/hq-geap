import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.js';
import {
  transformToHistoricoTranscricao,
  type HistoricoTranscricao
} from '@hq-geap/contracts/atendimentos';

loadEnvironment();

const require = createRequire(import.meta.url);
const apiRequire = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../apps/api/package.json')
);

function resolveModule<T>(name: string): T {
  try {
    return require(name) as T;
  } catch {
    return apiRequire(name) as T;
  }
}

const { Client } = resolveModule<typeof import('pg')>('pg');

export interface DatabaseQueryable {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface ReprocessOptions {
  apiUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

export interface RunPassOptions extends ReprocessOptions {
  specificIds?: string[];
  force?: boolean;
  dbClient?: InstanceType<typeof Client>;
  limit?: number;
}

export function findInconsistentConversationIdsQuery(options?: { force?: boolean }): string {
  if (options?.force) {
    return `
      select elevenlabs_conversation_id as "conversationId"
      from atendimentos
      where status = 'concluido'
      order by concluido_em desc nulls last
      limit $1
    `.trim();
  }

  return `
    select elevenlabs_conversation_id as "conversationId"
    from atendimentos
    where status = 'concluido'
      and (
        transcricao is null
        or jsonb_typeof(transcricao) != 'object'
        or transcricao->'historico' is null
        or jsonb_typeof(transcricao->'historico') != 'array'
        or exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(transcricao->'historico') = 'array' then transcricao->'historico'
              else '[]'::jsonb
            end
          ) as elem
          where elem->>'tempo_segundos' is null
             or elem->>'tempo_formatado' is null
             or elem->>'speaker' is null
             or elem->>'message' is null
             or (elem->>'tempo_segundos') !~ '^-?[0-9]+(\\.[0-9]+)?$'
        )
        or (
          jsonb_array_length(
            case
              when jsonb_typeof(transcricao->'historico') = 'array' then transcricao->'historico'
              else '[]'::jsonb
            end
          ) > 1
          and (
            select count(1)
            from jsonb_array_elements(
              case
                when jsonb_typeof(transcricao->'historico') = 'array' then transcricao->'historico'
                else '[]'::jsonb
              end
            ) as elem
            where case
              when (elem->>'tempo_segundos') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (elem->>'tempo_segundos')::numeric <= 0
              else true
            end
          ) > 1
        )
      )
    order by concluido_em desc nulls last
    limit $1
  `.trim();
}

export async function fetchElevenLabsConversation(
  conversationId: string,
  options?: ReprocessOptions
): Promise<Record<string, unknown> | null> {
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
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    return data;
  } catch (error) {
    console.warn(
      `  [aviso] Falha na requisição ElevenLabs para ${conversationId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function reprocessConversation(
  db: DatabaseQueryable,
  conversationId: string,
  options?: ReprocessOptions
): Promise<{ conversationId: string; success: boolean; error?: string }> {
  const conversationData = await fetchElevenLabsConversation(conversationId, options);
  if (!conversationData) {
    return {
      conversationId,
      success: false,
      error: 'Atendimento não encontrado ou falha de comunicação com ElevenLabs'
    };
  }

  const historicoTranscricao = transformToHistoricoTranscricao(conversationData);
  const serialized = JSON.stringify(historicoTranscricao);

  await db.query('begin');
  try {
    const result = await db.query(
      `
      update atendimentos
      set transcricao = $1::jsonb, atualizado_em = now()
      where elevenlabs_conversation_id = $2
        and status = 'concluido'
    `,
      [serialized, conversationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      await db.query('rollback');
      return {
        conversationId,
        success: false,
        error: `Atendimento concluído com elevenlabs_conversation_id=${conversationId} não encontrado no banco`
      };
    }

    await db.query('commit');
    return { conversationId, success: true };
  } catch (error) {
    await db.query('rollback');
    return {
      conversationId,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export const fetchElevenLabsTranscript = fetchElevenLabsConversation;
export const reprocessAtendimento = reprocessConversation;

export async function runPass(
  options?: RunPassOptions
): Promise<{ processed: number; success: number; failed: number }> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap';

  const shouldCloseDb = !options?.dbClient;
  const db = options?.dbClient ?? new Client({ connectionString: databaseUrl });

  if (shouldCloseDb && 'connect' in db && typeof db.connect === 'function') {
    await db.connect();
  }

  try {
    let conversationIds: string[] = [];

    if (options?.specificIds && options.specificIds.length > 0) {
      conversationIds = options.specificIds;
    } else {
      const effectiveLimit = Math.max(1, Math.trunc(Number(options?.limit) || 500));
      const queryText = findInconsistentConversationIdsQuery({
        force: options?.force
      });
      const result = await db.query<{ conversationId: string }>(queryText, [effectiveLimit]);
      conversationIds = result.rows.map((row) => row.conversationId);
    }

    if (conversationIds.length === 0) {
      console.log(`[${new Date().toISOString()}] Nenhuma transcrição inconsistente pendente de reprocessamento.`);
      return { processed: 0, success: 0, failed: 0 };
    }

    console.log(
      `[${new Date().toISOString()}] Reprocessando transcrições de ${conversationIds.length} atendimento(s)...`
    );

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < conversationIds.length; i++) {
      const conversationId = conversationIds[i]!;
      const outcome = await reprocessConversation(db, conversationId, {
        apiUrl: options?.apiUrl,
        apiKey: options?.apiKey,
        fetchFn: options?.fetchFn
      });

      if (outcome.success) {
        successCount++;
        console.log(`  ✓ [${i + 1}/${conversationIds.length}] Transcrição atualizada: ${conversationId}`);
      } else {
        failedCount++;
        console.error(`  ✗ [${i + 1}/${conversationIds.length}] Erro em ${conversationId}: ${outcome.error}`);
      }
    }

    console.log(
      `[${new Date().toISOString()}] Concluído: ${successCount}/${conversationIds.length} transcrições reprocessadas com sucesso (${failedCount} falhas).`
    );

    return {
      processed: conversationIds.length,
      success: successCount,
      failed: failedCount
    };
  } finally {
    if (shouldCloseDb && 'end' in db && typeof db.end === 'function') {
      await db.end();
    }
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const isLoop = args.includes('--loop');
  const isForce = args.includes('--force') || args.includes('--all');
  const specificIds = args.filter((arg) => !arg.startsWith('-'));

  if (specificIds.length > 0) {
    console.log(`Reprocessando transcrições de ${specificIds.length} ID(s) específico(s)...`);
    await runPass({ specificIds, force: isForce });
    return;
  }

  await runPass({ force: isForce });

  if (isLoop) {
    const intervalMs =
      Number(process.env.AUTO_REPROCESS_INTERVAL_MINUTES || 10) * 60 * 1000;
    console.log(
      `Loop de reprocessamento automático de transcrições ativo (a cada ${intervalMs / 60000} minutos).`
    );
    setInterval(async () => {
      try {
        await runPass({ force: isForce });
      } catch (err) {
        console.error('Erro no ciclo de reprocessamento de transcrições:', err);
      }
    }, intervalMs);
  }
}

const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedFile === currentFile || process.argv[1]?.endsWith('reprocessar-transcricoes.ts') || process.argv[1]?.endsWith('reprocessar-transcricoes.js')) {
  main().catch((err) => {
    console.error('Erro fatal no script de reprocessamento de transcrições:', err);
    process.exit(1);
  });
}
