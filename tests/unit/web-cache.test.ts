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

test('favicon e logo GEAP podem ser cacheados pelo navegador', async () => {
  const nginxConfig = await readFile(nginxConfigPath, 'utf8');
  const brandAssetCache =
    'add_header Cache-Control "public, max-age=604800" always;';

  for (const path of ['/favicon.ico', '/geap_saude_transparente.png']) {
    const escaped = path.replace(/\./g, '\\.');
    const locationBlock = new RegExp(
      `location = ${escaped} \\{[^}]*\\}`,
      'm'
    );
    const match = nginxConfig.match(locationBlock);
    assert.ok(match, `esperado location = ${path}`);
    const block = match[0];
    assert.match(block, new RegExp(brandAssetCache));
    assert.match(block, /try_files \$uri =404;/);
    assert.doesNotMatch(block, /Cache-Control "no-store/);
  }
});
