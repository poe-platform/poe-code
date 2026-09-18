import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const runtimeRoot = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
const consumerRoot = process.env.SAFE_BASH_PUBLIC_CONSUMER_ROOT;
if (!runtimeRoot || !consumerRoot) throw new Error('Set SAFE_BASH_CF_RUNTIME_ROOT and SAFE_BASH_PUBLIC_CONSUMER_ROOT to pinned workerd tooling and installed packages');

for (const runtime of ['node', 'workerd']) test(`#731 public ZIP creation and update on an immutable flat store in ${runtime}`, { timeout: 15000 }, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const { Miniflare } = require('miniflare');
  const alias = {};
  for (const [name, subpath, sourceName] of [['safe-bash', '.', '@poe-platform/safe-bash'], ['safe-fs', './core', 'poe-code/safe-fs/core']]) {
    const directory = resolve(consumerRoot, 'node_modules', '@poe-platform', name);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    const entry = manifest.exports[subpath];
    alias[sourceName] = resolve(directory, runtime === 'workerd' ? entry.workerd ?? entry.browser ?? entry.import : entry.import);
  }
  const bundle = await build({ entryPoints: [new URL('zip-flat-store.worker.mjs', import.meta.url).pathname], alias,
    nodePaths: [resolve(consumerRoot, 'node_modules')], bundle: true, write: false, platform: 'node',
    format: 'esm', target: 'es2022', external: ['cloudflare:*'], conditions: runtime === 'workerd' ? ['workerd', 'browser'] : ['node'] });
  const miniflare = runtime === 'workerd' ? new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], cf: false }) : undefined;
  try {
    await miniflare?.ready;
    const response = miniflare ? await miniflare.dispatchFetch('http://fixture/zip', { signal: context.signal })
      : await (await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))).default.fetch();
    assert.equal(response.status, 200, (await response.clone().text()).slice(0, 2000));
    const result = await response.json();
    assert.deepEqual(result.created, { status: 0, stderr: '' });
    assert.deepEqual(result.updated, { status: 0, stderr: '' });
    assert.deepEqual(result.payloads, [
      { name: 'cat.png', status: 0, bytes: [255, 0, 42, 13, 10], stderr: '' },
      { name: 'dog.png', status: 0, bytes: [0, 254, 10], stderr: '' },
      { name: 'fox.png', status: 0, bytes: [137, 80, 78, 71, 0, 255, 128], stderr: '' },
    ]);
    assert.equal(result.failed, 2);
    assert.equal(result.preserved, true);
    assert.ok(result.paths.every(path => !path.includes('.zip-')));
    context.diagnostic(JSON.stringify(result));
  } finally { await miniflare?.dispose(); }
});
