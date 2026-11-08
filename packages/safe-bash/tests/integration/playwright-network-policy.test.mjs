import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

const runtimeRoot = process.env.SAFE_BASH_CF_RUNTIME_ROOT;

test('Cloudflare browser intercepts forbidden redirects before the destination receives a request', {
  skip: !runtimeRoot && 'Set SAFE_BASH_CF_RUNTIME_ROOT to the pinned Cloudflare native runtime',
  timeout: 60000,
}, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const { Miniflare } = require('miniflare');
  assert.equal(require(resolve(runtimeRoot, 'node_modules/@cloudflare/playwright/package.json')).version, '1.3.6');
  const received = [];
  const server = createServer((request, response) => {
    received.push(request.url);
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Forbidden</title>');
  });
  let miniflare;
  try {
    await new Promise(accept => server.listen(0, '127.0.0.1', accept));
    const bundle = await build({
      entryPoints: [new URL('playwright-network-policy.worker.mjs', import.meta.url).pathname],
      nodePaths: [resolve(runtimeRoot, 'node_modules')], bundle: true, write: false,
      platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'],
    });
    miniflare = new Miniflare({
      modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'],
      unsafeEvalBinding: 'EVAL', cf: false, browserRendering: { binding: 'BROWSER' },
    });
    await miniflare.ready;
    for (const status of [301, 302, 303, 307, 308]) {
      const response = await miniflare.dispatchFetch('http://fixture/run', {
        method: 'POST', signal: context.signal,
        body: JSON.stringify({ status, forbidden: `http://127.0.0.1:${server.address().port}/forbidden-${status}`, baseline: process.env.SAFE_BASH_POLICY_BASELINE === '1' }),
      });
      assert.equal(response.status, 200, (await response.clone().text()).slice(0, 1000));
      const result = await response.json();
      context.diagnostic(JSON.stringify({ status, result, received }));
      if (process.env.SAFE_BASH_POLICY_BASELINE !== '1') {
        assert.equal(result.normal.url, 'https://allowed.example/final');
        assert.equal(result.normal.title, 'Native final');
        assert.ok(result.normal.cookies.some(cookie => cookie.name === 'hop' && cookie.value === 'present'));
        assert.ok(result.failures.some(failure => failure.message === 'Forbidden destination'));
      }
    }
    assert.deepEqual(received, [], 'independent destination must receive zero requests');
  } finally {
    await miniflare?.dispose();
    server.closeAllConnections();
    await new Promise(accept => server.close(accept));
  }
});
