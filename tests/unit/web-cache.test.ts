import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const nginxConfigPath = new URL('../../docker/nginx.conf', import.meta.url);

test('HTML da SPA não pode ser armazenado entre deploys', async () => {
  const nginxConfig = await readFile(nginxConfigPath, 'utf8');
  const htmlCacheHeaders =
    'add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;';

  assert.match(
    nginxConfig,
    new RegExp(`location = /index\\.html \\{[\\s\\S]*?${htmlCacheHeaders}`)
  );
  assert.match(
    nginxConfig,
    /location = \/index\.html \{[\s\S]*?add_header Pragma "no-cache" always;/
  );
  assert.match(
    nginxConfig,
    /location = \/index\.html \{[\s\S]*?add_header Expires "0" always;/
  );
  assert.match(
    nginxConfig,
    new RegExp(`location / \\{[\\s\\S]*?${htmlCacheHeaders}`)
  );
});
