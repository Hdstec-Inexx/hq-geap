import { Storage } from '@google-cloud/storage';
import fp from 'fastify-plugin';
import { Client as MinioClient } from 'minio';

declare module 'fastify' {
  interface FastifyInstance {
    storage: {
      resolveAudioUrl(
        reference: string | null,
        referenceDate?: Date | string | null
      ): Promise<string | null>;
    };
  }
}

export interface StorageClient {
  statObject(bucketName: string, objectName: string): Promise<unknown>;
  presignedGetObject(
    bucketName: string,
    objectName: string,
    expiry?: number
  ): Promise<string>;
}

export interface StoragePluginOptions {
  primaryClient?: StorageClient;
  r2Client?: StorageClient;
  now?: () => number;
}

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isAudioHistorical(
  referenceDate?: Date | string | null,
  now = Date.now()
): boolean {
  if (!referenceDate) {
    return false;
  }
  const timestamp =
    referenceDate instanceof Date
      ? referenceDate.getTime()
      : typeof referenceDate === 'string'
        ? new Date(referenceDate).getTime()
        : NaN;

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return now - timestamp >= THIRTY_DAYS_MS;
}

export function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const candidate = err as {
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
    name?: unknown;
    message?: unknown;
  };
  const code =
    typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const name =
    typeof candidate.name === 'string' ? candidate.name.toLowerCase() : '';
  const message =
    typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';

  return (
    code === 'notfound' ||
    code === 'nosuchkey' ||
    name === 'notfound' ||
    name === 'nosuchkey' ||
    candidate.statusCode === 404 ||
    candidate.status === 404 ||
    message.includes('not found') ||
    message.includes('no such key') ||
    message.includes('does not exist')
  );
}

function createS3CompatibleClient(params: {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}): MinioClient {
  const url = new URL(params.endpoint);
  return new MinioClient({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    accessKey: params.accessKey,
    secretKey: params.secretKey,
    region: params.region
  });
}

function publicUrl(baseUrl: string, reference: string) {
  const encodedReference = reference
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl.replace(/\/$/, '')}/${encodedReference}`;
}

interface StorageTarget {
  name: 'primary' | 'r2';
  bucket: string;
  client: StorageClient;
}

export default fp<StoragePluginOptions>(
  async (app, options) => {
    const provider = app.config.STORAGE_PROVIDER;
    const minio: StorageClient | null =
      options?.primaryClient ??
      (provider === 'minio' && app.config.STORAGE_ENDPOINT
        ? createS3CompatibleClient({
            endpoint: app.config.STORAGE_ENDPOINT,
            accessKey: app.config.STORAGE_ACCESS_KEY!,
            secretKey: app.config.STORAGE_SECRET_KEY!
          })
        : null);

    const isR2Configured = Boolean(
      app.config.R2_ENDPOINT &&
      app.config.R2_BUCKET &&
      app.config.R2_ACCESS_KEY &&
      app.config.R2_SECRET_KEY
    );

    const r2: StorageClient | null =
      options?.r2Client ??
      (isR2Configured
        ? createS3CompatibleClient({
            endpoint: app.config.R2_ENDPOINT!,
            accessKey: app.config.R2_ACCESS_KEY!,
            secretKey: app.config.R2_SECRET_KEY!,
            region: 'auto'
          })
        : null);

    const gcs = provider === 'gcs' ? new Storage() : null;

    const primaryTarget: StorageTarget | null = minio
      ? {
          name: 'primary',
          bucket: app.config.STORAGE_BUCKET,
          client: minio
        }
      : null;

    const r2Target: StorageTarget | null =
      r2 && app.config.R2_BUCKET
        ? {
            name: 'r2',
            bucket: app.config.R2_BUCKET,
            client: r2
          }
        : null;

    app.decorate('storage', {
      async resolveAudioUrl(
        reference: string | null,
        referenceDate?: Date | string | null
      ) {
        if (!reference || !reference.trim()) {
          return null;
        }

        if (provider === 'gcs') {
          const [url] = await gcs!
            .bucket(app.config.STORAGE_BUCKET)
            .file(reference)
            .getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60_000 });
          return url;
        }

        if (provider === 'public') {
          return publicUrl(app.config.STORAGE_PUBLIC_URL, reference);
        }

        const now = options?.now ? options.now() : Date.now();
        const historical = isAudioHistorical(referenceDate, now);

        let firstTarget: StorageTarget | null;
        let secondTarget: StorageTarget | null;

        if (r2Target) {
          if (historical) {
            firstTarget = r2Target;
            secondTarget = primaryTarget;
          } else {
            firstTarget = primaryTarget;
            secondTarget = r2Target;
          }
        } else {
          firstTarget = primaryTarget;
          secondTarget = null;
        }

        const candidateTargets = [firstTarget, secondTarget].filter(
          (target): target is StorageTarget => Boolean(target)
        );

        let presignedUrl: string | null = null;

        for (const target of candidateTargets) {
          try {
            await target.client.statObject(target.bucket, reference);
            presignedUrl = await target.client.presignedGetObject(
              target.bucket,
              reference,
              15 * 60
            );
            break;
          } catch (error) {
            if (!isNotFoundError(error)) {
              throw error;
            }
          }
        }

        if (!presignedUrl) {
          app.log.warn(
            {
              reference,
              referenceDate: referenceDate ? String(referenceDate) : null,
              primaryTarget: firstTarget?.name ?? null,
              fallbackTarget: secondTarget?.name ?? null
            },
            'Audio not found in storage'
          );
          return null;
        }

        return presignedUrl;
      }
    });
  },
  { name: 'storage', dependencies: ['config'] }
);
