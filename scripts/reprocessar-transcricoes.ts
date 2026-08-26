import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.js';
import {
  runPass,
  type DatabaseQueryable,
  type ReprocessOptions,
  type RunPassOptions,
  type ElevenLabsFetchOutcome,
  type ReprocessOutcome,
  REPROCESSAMENTO_MAX_TENTATIVAS,
  REPROCESSAMENTO_DATA_CORTE,
  REPROCESSAMENTO_LOTE_PADRAO,
  buildInconsistentTranscriptionSqlPredicate,
  findInconsistentConversationIdsQuery,
  fetchElevenLabsConversationDetail,
  fetchElevenLabsConversation,
  fetchElevenLabsTranscript,
  reprocessConversation,
  reprocessAtendimento
} from '../apps/api/src/modules/atendimentos/reprocessamento.js';

loadEnvironment();

export {
  runPass,
  type DatabaseQueryable,
  type ReprocessOptions,
  type RunPassOptions,
  type ElevenLabsFetchOutcome,
  type ReprocessOutcome,
  REPROCESSAMENTO_MAX_TENTATIVAS,
  REPROCESSAMENTO_DATA_CORTE,
  REPROCESSAMENTO_LOTE_PADRAO,
  buildInconsistentTranscriptionSqlPredicate,
  findInconsistentConversationIdsQuery,
  fetchElevenLabsConversationDetail,
  fetchElevenLabsConversation,
  fetchElevenLabsTranscript,
  reprocessConversation,
  reprocessAtendimento
};

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
if (
  executedFile === currentFile ||
  process.argv[1]?.endsWith('reprocessar-transcricoes.ts') ||
  process.argv[1]?.endsWith('reprocessar-transcricoes.js')
) {
  main().catch((err) => {
    console.error('Erro fatal no script de reprocessamento de transcrições:', err);
    process.exit(1);
  });
}
