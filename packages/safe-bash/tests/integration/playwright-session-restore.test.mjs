import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const runtimeRoot = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
const consumerRoot = process.env.SAFE_BASH_PUBLIC_CONSUMER_ROOT;
if (!runtimeRoot || !consumerRoot) throw new Error('Set SAFE_BASH_CF_RUNTIME_ROOT and SAFE_BASH_PUBLIC_CONSUMER_ROOT to pinned browser tooling and installed public packages');

test('public CLI restores a live Cloudflare context after transport and controller replacement', { timeout: 90000 }, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const { Miniflare } = require('miniflare');
  const alias = Object.fromEntries([
    ['@poe-platform/safe-bash', '.'], ['@poe-platform/safe-bash/commands/playwright', './commands/playwright'],
    ['@poe-platform/safe-fs/core', './core'],
  ].map(([specifier, subpath]) => {
    const name = specifier.startsWith('@poe-platform/safe-fs') ? 'safe-fs' : 'safe-bash';
    const directory = resolve(consumerRoot, 'node_modules', '@poe-platform', name);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    const entry = manifest.exports[subpath];
    return [specifier, resolve(directory, entry.workerd ?? entry.browser ?? entry.import)];
  }));
  const bundle = await build({
    entryPoints: [new URL('playwright-session-restore.worker.mjs', import.meta.url).pathname],
    nodePaths: [resolve(consumerRoot, 'node_modules'), resolve(runtimeRoot, 'node_modules')],
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'],
    conditions: ['workerd', 'browser'],
    alias,
  });
  const miniflare = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'],
    unsafeEvalBinding: 'EVAL', cf: false, browserRendering: { binding: 'BROWSER' },
  });
  try {
    await miniflare.ready;
    const response = await miniflare.dispatchFetch('http://fixture/restore', { signal: context.signal });
    assert.equal(response.status, 200, (await response.clone().text()).slice(0, 4000));
    const result = await response.json();
    context.diagnostic(JSON.stringify(result));
    for (const output of result.outputs) assert.equal(output.exitCode, 0, output.stderr);
    assert.equal(result.selectedText, 'Restored selected tab');
    assert.equal(result.cookieRetained, true);
    assert.equal(result.restoredTabCount, result.tabCount);
    assert.equal(result.selectedIndex, result.tabCount - 1);
    assert.equal(result.stale.exitCode, 1);
    assert.match(result.stale.stderr, /stale snapshot ref/);
    assert.equal(result.close.exitCode, 0, result.close.stderr);
    assert.equal(result.remaining, 0);
  } finally { await miniflare.dispose(); }
});
