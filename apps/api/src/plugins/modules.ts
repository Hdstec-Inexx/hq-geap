import autoload from '@fastify/autoload';
import fp from 'fastify-plugin';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export default fp(
  async (app) => {
    await app.register(autoload, {
      dir: join(currentDirectory, '..', 'modules'),
      dirNameRoutePrefix: false,
      matchFilter: (path) => /routes\.(?:js|ts)$/.test(path)
    });
  },
  { name: 'modules', dependencies: ['auth'] }
);
