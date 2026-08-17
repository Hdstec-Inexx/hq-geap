import { Client as MinioClient } from 'minio';

/**
 * Creates a valid MPEG-1 Layer 3 MP3 buffer.
 * Frame header: 0xFF, 0xFB, 0x90, 0x64 (MPEG-1, Layer 3, 128 kbps, 44100 Hz, Joint Stereo)
 * Frame size: floor(144 * 128000 / 44100) = 417 bytes
 * Each frame represents 1152 samples (~26.12 ms)
 */
export function generateTestMp3(durationSeconds: number = 60): Buffer {
  const frameSize = 417;
  const samplesPerFrame = 1152;
  const sampleRate = 44100;
  const framesCount = Math.ceil((durationSeconds * sampleRate) / samplesPerFrame);
  const buffer = Buffer.alloc(framesCount * frameSize, 0);

  for (let i = 0; i < framesCount; i++) {
    const offset = i * frameSize;
    buffer[offset] = 0xff;
    buffer[offset + 1] = 0xfb; // MPEG-1 Layer 3, No CRC
    buffer[offset + 2] = 0x90; // 128 kbps, 44100 Hz, No padding
    buffer[offset + 3] = 0x64; // Joint stereo, no copyright, original
    // Fill side info and main data with valid silent data
  }

  return buffer;
}

export async function ensureMinioTestAudio(
  objectKeys: string[] = ['atendimentos/teste.mp3', 'conv-fixture-concluido-001.mp3', 'teste-player.mp3'],
  durationSeconds: number = 60
) {
  const minio = new MinioClient({
    endPoint: process.env.STORAGE_ENDPOINT ? new URL(process.env.STORAGE_ENDPOINT).hostname : '127.0.0.1',
    port: process.env.STORAGE_ENDPOINT ? Number(new URL(process.env.STORAGE_ENDPOINT).port) : 9000,
    useSSL: false,
    accessKey: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin'
  });

  const bucket = process.env.STORAGE_BUCKET ?? 'hq-geap';
  const bucketExists = await minio.bucketExists(bucket).catch(() => false);
  if (!bucketExists) {
    await minio.makeBucket(bucket, 'us-east-1').catch(() => {});
  }

  const audioBuffer = generateTestMp3(durationSeconds);
  for (const key of objectKeys) {
    await minio.putObject(bucket, key, audioBuffer, audioBuffer.length, {
      'Content-Type': 'audio/mpeg'
    }).catch((err) => {
      console.warn(`Could not upload ${key} to MinIO:`, err);
    });
  }
}
