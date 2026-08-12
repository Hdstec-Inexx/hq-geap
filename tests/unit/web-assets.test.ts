import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const logoFiles = ['favicon.ico', 'geap_saude_transparente.png'] as const;

const logosDir = new URL('../../logos/', import.meta.url);
const publicDir = new URL('../../apps/web/public/', import.meta.url);
const indexHtmlPath = new URL('../../apps/web/index.html', import.meta.url);

test('logo GEAP e favicon existem em logos/ (fonte) e em apps/web/public/ (servidos)', async () => {
  for (const file of logoFiles) {
    const sourcePath = new URL(file, logosDir);
    const publicPath = new URL(file, publicDir);

    const [sourceStat, publicStat] = await Promise.all([
      stat(sourcePath),
      stat(publicPath)
    ]);

    assert.ok(sourceStat.isFile(), `esperado arquivo fonte logos/${file}`);
    assert.ok(publicStat.isFile(), `esperado asset servido apps/web/public/${file}`);
    assert.ok(sourceStat.size > 0, `logos/${file} não pode estar vazio`);
    assert.ok(publicStat.size > 0, `apps/web/public/${file} não pode estar vazio`);

    const [sourceBytes, publicBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(publicPath)
    ]);
    assert.deepEqual(
      publicBytes,
      sourceBytes,
      `apps/web/public/${file} deve espelhar logos/${file}`
    );
  }
});

test('documento HTML referencia o favicon GEAP', async () => {
  const html = await readFile(indexHtmlPath, 'utf8');

  assert.match(
    html,
    /<link\s+rel=["']icon["']\s+href=["']\/favicon\.ico["'][^>]*>/i
  );
});
