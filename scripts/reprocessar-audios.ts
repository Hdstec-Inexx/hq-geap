import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.js';

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
const { Client: MinioClient } = resolveModule<typeof import('minio')>('minio');

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap';
const elevenlabsApiUrl = (
  process.env.ELEVENLABS_API_URL ?? 'https://api.elevenlabs.io'
).replace(/\/$/, '');
const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;
const storageProvider = process.env.STORAGE_PROVIDER ?? 'public';
const storageBucket = process.env.STORAGE_BUCKET ?? 'hq-geap';
const storageEndpoint = process.env.STORAGE_ENDPOINT;
const storageAccessKey = process.env.STORAGE_ACCESS_KEY;
const storageSecretKey = process.env.STORAGE_SECRET_KEY;

function getMinioClient(): InstanceType<typeof MinioClient> | null {
  if (storageProvider !== 'minio') return null;
  if (!storageEndpoint || !storageAccessKey || !storageSecretKey) {
    throw new Error('STORAGE_ENDPOINT, STORAGE_ACCESS_KEY e STORAGE_SECRET_KEY são obrigatórios para STORAGE_PROVIDER=minio');
  }
  const url = new URL(storageEndpoint);
  return new MinioClient({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    accessKey: storageAccessKey,
    secretKey: storageSecretKey
  });
}

const minioClient = getMinioClient();

async function getGcsClient() {
  if (storageProvider !== 'gcs') return null;
  const { Storage } = resolveModule<{ Storage: new () => { bucket: (name: string) => { file: (key: string) => { save: (buf: Buffer, opts: Record<string, unknown>) => Promise<void> } } } }>('@google-cloud/storage');
  return new Storage();
}

async function uploadAudio(key: string, buffer: Buffer): Promise<void> {
  if (storageProvider === 'minio' && minioClient) {
    await minioClient.putObject(
      storageBucket,
      key,
      buffer,
      buffer.length,
      { 'Content-Type': 'audio/mpeg' }
    );
  } else if (storageProvider === 'gcs') {
    const gcs = await getGcsClient();
    if (!gcs) throw new Error('GCS client indisponível');
    const file = gcs.bucket(storageBucket).file(key);
    await file.save(buffer, {
      contentType: 'audio/mpeg',
      resumable: false
    });
  } else {
    // Modo public / local MinIO padrão
    const localMinio = new MinioClient({
      endPoint: '127.0.0.1',
      port: 9000,
      useSSL: false,
      accessKey: storageAccessKey ?? 'minioadmin',
      secretKey: storageSecretKey ?? 'minioadmin'
    });
    await localMinio.putObject(
      storageBucket,
      key,
      buffer,
      buffer.length,
      { 'Content-Type': 'audio/mpeg' }
    );
  }
}

async function fetchElevenLabsAudio(conversationId: string): Promise<Buffer | null> {
  const url = `${elevenlabsApiUrl}/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`;
  const headers: Record<string, string> = {};
  if (elevenlabsApiKey) {
    headers['xi-api-key'] = elevenlabsApiKey;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.warn(`  [aviso] Falha na requisição ElevenLabs para ${conversationId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function runPass(specificIds?: string[]): Promise<{ processed: number; success: number }> {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    let conversationIds: string[] = [];

    if (specificIds && specificIds.length > 0) {
      conversationIds = specificIds;
    } else {
      const result = await db.query<{ conversationId: string }>(`
        select elevenlabs_conversation_id as "conversationId"
        from atendimentos
        where status = 'concluido'
          and (audio_url is null or audio_url = '')
        order by concluido_em desc nulls last
        limit 500
      `);
      conversationIds = result.rows.map((row) => row.conversationId);
    }

    if (conversationIds.length === 0) {
      return { processed: 0, success: 0 };
    }

    console.log(`[${new Date().toISOString()}] Reprocessando áudio de ${conversationIds.length} atendimento(s)...`);
    let successCount = 0;

    for (let i = 0; i < conversationIds.length; i++) {
      const conversationId = conversationIds[i]!;
      const key = `${conversationId}.mp3`;

      try {
        const audioBuffer = await fetchElevenLabsAudio(conversationId);
        if (!audioBuffer || audioBuffer.length === 0) {
          continue;
        }

        await uploadAudio(key, audioBuffer);
        await db.query(`
          update atendimentos
          set audio_url = $1, atualizado_em = now()
          where elevenlabs_conversation_id = $2
        `, [key, conversationId]);

        console.log(`  ✓ [${i + 1}/${conversationIds.length}] Áudio persistido: ${key}`);
        successCount++;
      } catch (err) {
        console.error(`  ✗ Erro em ${conversationId}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[${new Date().toISOString()}] Concluído: ${successCount}/${conversationIds.length} áudios recuperados.`);
    return { processed: conversationIds.length, success: successCount };
  } finally {
    await db.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isLoop = args.includes('--loop');
  const specificIds = args.filter((arg) => !arg.startsWith('-'));

  if (specificIds.length > 0) {
    console.log(`Reprocessando ${specificIds.length} ID(s) específico(s)...`);
    await runPass(specificIds);
    return;
  }

  // Executa uma primeira passagem
  await runPass();

  if (isLoop) {
    const intervalMs = Number(process.env.AUTO_REPROCESS_INTERVAL_MINUTES || 10) * 60 * 1000;
    console.log(`Loop de reprocessamento automático ativo (a cada ${intervalMs / 60000} minutos).`);
    setInterval(async () => {
      try {
        await runPass();
      } catch (err) {
        console.error('Erro no ciclo de reprocessamento:', err);
      }
    }, intervalMs);
  }
}

main().catch((err) => {
  console.error('Erro fatal no script de reprocessamento:', err);
  process.exit(1);
});
