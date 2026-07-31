import { fileURLToPath } from 'node:url';

const defaultEnvironmentFile = fileURLToPath(
  new URL('../../../.env', import.meta.url)
);

export function loadEnvironment(path = defaultEnvironmentFile) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
