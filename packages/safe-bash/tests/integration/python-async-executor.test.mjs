import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

const runtimeRoot = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
const consumerRoot = process.env.SAFE_BASH_PUBLIC_CONSUMER_ROOT;
if (!runtimeRoot || !consumerRoot) throw new Error('Set SAFE_BASH_CF_RUNTIME_ROOT and SAFE_BASH_PUBLIC_CONSUMER_ROOT to pinned workerd tooling and installed packages');

test('public async executor transport works in workerd without shared-memory globals', { timeout: 15000 }, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const { Miniflare } = require('miniflare');
  const alias = Object.fromEntries([
    ['safe-bash', '.'], ['safe-bash', './commands/python'], ['safe-fs', './core'],
  ].map(([name, subpath]) => {
    const directory = resolve(consumerRoot, 'node_modules', '@poe-platform', name);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    const entry = manifest.exports[subpath];
    return ['@poe-platform/' + name + subpath.slice(1), resolve(directory, entry.workerd ?? entry.browser ?? entry.import)];
  }));
  const bundle = await build({
    entryPoints: [new URL('python-async-executor.worker.mjs', import.meta.url).pathname], alias,
    nodePaths: [resolve(consumerRoot, 'node_modules')], bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'], conditions: ['workerd', 'browser'],
  });
  const miniflare = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'], cf: false,
  });
  try {
    await miniflare.ready;
    const response = await miniflare.dispatchFetch('http://fixture/executor', { signal: context.signal });
    assert.equal(response.status, 200, (await response.clone().text()).slice(0, 2000));
    const result = await response.json();
    assert.equal(result.configurationValid, true);
    assert.equal(result.exitCode, 7, result.stderr);
    assert.deepEqual(result.bytes, [0, 255, 42]);
    assert.deepEqual(result.phases, ['initializing', 'ready', 'finished']);
    assert.equal(result.retired, 2);
    assert.equal(result.saturated.exitCode, 1);
    assert.match(result.saturated.stderr, /capacity exhausted/);
    assert.deepEqual(result.occupied, { active: 1, capacity: 1, closed: false });
    assert.equal(result.recovered, 7);
    assert.deepEqual(result.available, { active: 0, capacity: 1, closed: false });
    context.diagnostic(JSON.stringify(result));
  } finally { await miniflare.dispose(); }
});
