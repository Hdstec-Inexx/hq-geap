import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const loaders = [
  '../../scripts/environment.ts',
  '../../apps/api/src/environment.ts'
] as const;

for (const loaderModule of loaders) {
  test(`${loaderModule} loads a file without replacing injected variables`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hq-geap-env-'));
    const environmentFile = join(directory, '.env');
    const loadedVariable = `HQ_GEAP_LOADED_${process.pid}`;
    const preservedVariable = `HQ_GEAP_PRESERVED_${process.pid}`;

    try {
      await writeFile(
        environmentFile,
        `${loadedVariable}=from-file\n${preservedVariable}=from-file\n`,
        'utf8'
      );
      delete process.env[loadedVariable];
      process.env[preservedVariable] = 'from-process';

      const environment = await import(loaderModule);
      environment.loadEnvironment(environmentFile);

      assert.equal(process.env[loadedVariable], 'from-file');
      assert.equal(process.env[preservedVariable], 'from-process');
    } finally {
      delete process.env[loadedVariable];
      delete process.env[preservedVariable];
      await rm(directory, { recursive: true, force: true });
    }
  });
}
