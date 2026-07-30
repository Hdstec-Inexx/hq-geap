import { Storage } from '@google-cloud/storage';
import fp from 'fastify-plugin';
import { Client as MinioClient } from 'minio';

declare module 'fastify' {
  interface FastifyInstance {
    storage: {
      resolveAudioUrl(reference: string | null): Promise<string | null>;
    };
  }
}

function publicUrl(baseUrl: string, reference: string) {
  const encodedReference = reference
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl.replace(/\/$/, '')}/${encodedReference}`;
}

export default fp(
  async (app) => {
    const provider = app.config.STORAGE_PROVIDER;
    const minioEndpoint =
      provider === 'minio' ? new URL(app.config.STORAGE_ENDPOINT!) : null;
    const minio = minioEndpoint
      ? new MinioClient({
          endPoint: minioEndpoint.hostname,
          port: minioEndpoint.port
            ? Number(minioEndpoint.port)
            : minioEndpoint.protocol === 'https:'
              ? 443
              : 80,
          useSSL: minioEndpoint.protocol === 'https:',
          accessKey: app.config.STORAGE_ACCESS_KEY!,
          secretKey: app.config.STORAGE_SECRET_KEY!
        })
      : null;
    const gcs = provider === 'gcs' ? new Storage() : null;

    app.decorate('storage', {
      async resolveAudioUrl(reference: string | null) {
        if (!reference) {
          return null;
        }
        if (provider === 'minio') {
          return minio!.presignedGetObject(
            app.config.STORAGE_BUCKET,
            reference,
            15 * 60
          );
        }
        if (provider === 'gcs') {
          const [url] = await gcs!
            .bucket(app.config.STORAGE_BUCKET)
            .file(reference)
            .getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60_000 });
          return url;
        }
        return publicUrl(app.config.STORAGE_PUBLIC_URL, reference);
      }
    });
  },
  { name: 'storage', dependencies: ['config'] }
);
