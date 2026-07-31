import { ZodError } from 'zod';
import { loadEnvironment } from './environment.js';
import { parseAppConfig } from './plugins/config.js';

export type ConfigCheckResult =
  | { ok: true }
  | { ok: false; message: string };

export function checkAppConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): ConfigCheckResult {
  try {
    parseAppConfig(env);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      return {
        ok: false,
        message: `Invalid API config — fix environment variables before migrate/start.\n${details}`
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('check-config.js') || entry.endsWith('check-config.ts')) {
  loadEnvironment();
  const result = checkAppConfig(process.env);
  if (!result.ok) {
    console.error(result.message);
    console.error(
      'See docs/deploy/easypanel.md — production needs JWT_SECRET (>=32), INGESTION_API_KEY (>=32), STORAGE_PROVIDER=minio|gcs (not public), storage URLs/creds, CORS_ORIGIN, ELEVENLABS_API_KEY, DATABASE_URL.'
    );
    process.exit(1);
  }
  console.log('API config OK.');
}
