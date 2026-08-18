import { Storage } from '@google-cloud/storage';
import { Client as MinioClient } from 'minio';
import pg from 'pg';
import { loadEnvironment } from './environment.js';

loadEnvironment();

const { Client } = pg;
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

function getMinioClient(): MinioClient | null {
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
const gcsClient = storageProvider === 'gcs' ? new Storage() : null;

async function uploadAudio(key: string, buffer: Buffer): Promise<void> {
  if (storageProvider === 'minio' && minioClient) {
    await minioClient.putObject(
      storageBucket,
      key,
      buffer,
      buffer.length,
      { 'Content-Type': 'audio/mpeg' }
    );
  } else if (storageProvider === 'gcs' && gcsClient) {
    const file = gcsClient.bucket(storageBucket).file(key);
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

  const response = await fetch(url, { headers });
  if (!response.ok) {
    console.warn(`  [aviso] ElevenLabs respondeu status ${response.status} para ${conversationId}`);
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function reprocessar() {
  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    let conversationIds: string[] = [];

    if (cliArgs.length > 0) {
      conversationIds = cliArgs;
      console.log(`Buscando ${conversationIds.length} conversa(s) especificada(s) via CLI...`);
    } else {
      const result = await db.query<{ conversationId: string }>(`
        select elevenlabs_conversation_id as "conversationId"
        from atendimentos
        where status = 'concluido'
          and (audio_url is null or audio_url = '')
        order by concluido_em desc nulls last
      `);
      conversationIds = result.rows.map((row) => row.conversationId);
      console.log(`Encontrados ${conversationIds.length} atendimento(s) concluído(s) sem áudio no banco.`);
    }

    if (conversationIds.length === 0) {
      console.log('Nenhum atendimento pendente de áudio para reprocessar.');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < conversationIds.length; i++) {
      const conversationId = conversationIds[i]!;
      const key = `${conversationId}.mp3`;
      console.log(`[${i + 1}/${conversationIds.length}] Processando ${conversationId}...`);

      try {
        const audioBuffer = await fetchElevenLabsAudio(conversationId);
        if (!audioBuffer || audioBuffer.length === 0) {
          console.log(`  ✗ Áudio não disponível para ${conversationId}`);
          failCount++;
          continue;
        }

        await uploadAudio(key, audioBuffer);
        await db.query(`
          update atendimentos
          set audio_url = $1, atualizado_em = now()
          where elevenlabs_conversation_id = $2
        `, [key, conversationId]);

        console.log(`  ✓ Áudio gravado no bucket '${storageBucket}' e vinculado: ${key}`);
        successCount++;
      } catch (err) {
        console.error(`  ✗ Erro ao processar ${conversationId}:`, err instanceof Error ? err.message : err);
        failCount++;
      }
    }

    console.log(`\nResumo do reprocessamento:`);
    console.log(`  Sucesso: ${successCount}`);
    console.log(`  Falhas/Indisponíveis: ${failCount}`);
    console.log(`  Total: ${conversationIds.length}`);
  } finally {
    await db.end();
  }
}

reprocessar().catch((err) => {
  console.error('Erro fatal no reprocessamento:', err);
  process.exit(1);
});
