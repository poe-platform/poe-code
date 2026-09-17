import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runtimeRoot = process.env.SAFE_BASH_CF_RUNTIME_ROOT;

test('opt-in local Cloudflare CLI interrupt drains native cleanup', {
  skip: !runtimeRoot && 'Set SAFE_BASH_CF_RUNTIME_ROOT to an external pinned runtime with Chromium prerequisites',
  timeout: 90000,
}, async context => {
  const require = createRequire(resolve(runtimeRoot, 'package.json'));
  const { build } = require('esbuild');
  const { Miniflare } = require('miniflare');
  const configuredRoot = process.env.SAFE_BASH_TEST_ROOT;
  const artifactRoot = configuredRoot?.startsWith('file:') ? fileURLToPath(configuredRoot) : configuredRoot && resolve(configuredRoot);
  const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
  const alias = Object.fromEntries([
    ['playwright', 'commands/playwright/index'], ['shell', 'shell/index'], ['memory', 'fs/memory/index'],
  ].map(([name, path]) => [`@safe-bash-fixture/${name}`, resolve(artifactRoot || sourceRoot, `${path}.${artifactRoot ? 'js' : 'ts'}`)]));
  const profile = {
    compatibilityDate: '2026-07-08',
    compatibilityFlags: ['nodejs_compat'],
    unsafeEvalBinding: 'EVAL',
  };
  context.diagnostic(JSON.stringify({ profile, alias, requirement: 'This local fixture explicitly requires unsafeEvalBinding: EVAL; it does not qualify a runtime without that binding.' }));
  const versions = Object.fromEntries(['@cloudflare/playwright', 'miniflare', 'esbuild'].map(name => [name, require(resolve(runtimeRoot, 'node_modules', name, 'package.json')).version]));
  assert.deepEqual(versions, { '@cloudflare/playwright': '1.3.6', miniflare: '4.20260708.1', esbuild: '0.25.10' });
  const specifications = [
    { name: 'zero-512KiB', bytes: 512 * 1024, byte: 0 },
    { name: 'printable-8MiB', bytes: 8 * 1024 * 1024, byte: 97 },
    { name: 'zero-6MiB', bytes: 6 * 1024 * 1024, byte: 0 },
  ];
  const uploads = [];
  const uploadCompletions = new Map(specifications.map(specification => [specification.name, Promise.withResolvers()]));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const specification = specifications.find(entry => entry.name === url.searchParams.get('case'));
    if (!specification) { response.writeHead(404).end(); return; }
    try {
      if (request.method === 'POST') {
        let bytes = 0;
        let matchingBytes = true;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (!chunk.every(value => value === specification.byte)) matchingBytes = false;
        }
        const upload = { name: specification.name, bytes, matchingBytes };
        uploads.push(upload);
        response.writeHead(200, { 'content-type': 'text/plain' }).end('done');
        uploadCompletions.get(specification.name).resolve(upload);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><button id="send">Send</button><script>
        document.querySelector('#send').addEventListener('click', async () => {
          const payload = new Uint8Array(${specification.bytes});
          payload.fill(${specification.byte});
          await fetch('/upload?case=${specification.name}', {method:'POST',body:payload});
          document.title = 'Upload complete';
        });
      </script>`);
    } catch (error) {
      response.destroy();
      uploadCompletions.get(specification.name).resolve({ error: String(error) });
    }
  });
  let miniflare;
  const results = [];
  try {
    const bundle = await build({
      entryPoints: [new URL('playwright-cloudflare.worker.mjs', import.meta.url).pathname],
      nodePaths: [resolve(runtimeRoot, 'node_modules')],
      alias,
      bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', external: ['cloudflare:*'],
    });
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    miniflare = new Miniflare({
      modules: true, script: bundle.outputFiles[0].text,
      ...profile,
      cf: false, browserRendering: { binding: 'BROWSER' },
    });
    await miniflare.ready;
    for (const specification of specifications) {
      await context.test(specification.name, async () => {
        const response = await miniflare.dispatchFetch('http://experiment/run', {
          method: 'POST',
          signal: context.signal,
          body: JSON.stringify({ name: specification.name, url: `http://127.0.0.1:${server.address().port}/?case=${specification.name}` }),
        });
        assert.equal(response.status, 200, (await response.clone().text()).slice(0, 1000));
        const result = await response.json();
        results.push(result);
        context.diagnostic(JSON.stringify(result));
        assert.ok(result.nativeContextCloses.length > 0);
        assert.equal(result.allNativeContextClosesSettled, true);
        assert.ok(result.nativeContextCloses.every(operation => operation.settledMs >= operation.startedMs));
        assert.equal(result.connectedAfterDispose, false);
        assert.equal(result.shellDispose.status, 'fulfilled');
        assert.equal(result.sessionPresentBeforeDelete, true);
        assert.equal(result.connectedBeforeDelete, false);
        assert.equal(result.absence.observed, true);
        assert.equal(result.deletion.status, 200);
        assert.equal(result.releaseDeadlineMs, 5000);
        assert.deepEqual(result.releaseRequests.map(request => request.method), ['GET', 'DELETE', ...Array(result.absence.polls).fill('GET')]);
        assert.ok(result.releaseRequests.every(request => request.signalAttached));
        assert.deepEqual(JSON.parse(result.deletion.body), { status: 'closed' });
        const interrupt = result.events.find(event => event.name === 'interrupt-fulfilled');
        const release = result.events.find(event => event.name === 'release-start');
        assert.ok(interrupt);
        assert.ok(release.elapsedMs >= interrupt.elapsedMs);
        assert.ok(result.nativeContextCloses.every(operation => operation.settledMs <= release.elapsedMs));
        assert.equal(result.commands.length, 3);
        assert.equal(result.commands[0].exitCode, 0);
        assert.equal(result.commands[1].exitCode, 0);
        assert.ok(result.commands[1].stdout.includes('[ref=e1]'));
        assert.equal(result.routes.filter(route => route.method === 'GET').length, 1);
        const click = result.commands[2];
        assert.ok(click.settledMs - click.startedMs < 10000);
        assert.ok(result.shellDispose.settledMs - result.shellDispose.startedMs < 5000);
        if (specification.name === 'zero-6MiB') {
          assert.equal(result.routes.filter(route => route.method === 'POST').length, 0);
          assert.equal(click.exitCode, 1);
          assert.ok(click.stderr.includes('Timeout 3000ms exceeded'));
          assert.ok(result.absence.elapsedMs <= click.settledMs);
        } else {
          assert.equal(click.exitCode, 0);
          assert.equal(result.uploadCompleted, true);
          assert.equal(result.routes.filter(route => route.method === 'POST').length, 1);
          assert.deepEqual(await uploadCompletions.get(specification.name).promise, {
            name: specification.name, bytes: specification.bytes, matchingBytes: true,
          });
        }
      });
    }
  } finally {
    try { await miniflare?.dispose(); }
    finally {
      server.closeAllConnections();
      await new Promise(accept => server.close(accept));
      context.diagnostic(JSON.stringify({ scope: 'local Miniflare only', processExitClaim: false, node: process.version, versions, profile, alias, results, uploads }));
    }
  }
});
