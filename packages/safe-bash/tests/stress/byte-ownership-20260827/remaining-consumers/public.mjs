import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Shell, createMemoryFileSystem, structuredCommands, searchCommands } from 'virtual-bash';
import { archiveCommands } from 'virtual-bash/commands/archive';
import { networkCommands } from 'virtual-bash/commands/network';
import { vectors, commands } from './vectors.mjs';
import { borrowed, complete, hex, splitArchive } from './fixtures.mjs';

assert.equal(fileURLToPath(import.meta.resolve('virtual-bash')), process.env.REMAINING_PUBLIC);
assert.equal(fileURLToPath(import.meta.resolve('virtual-bash/commands/archive')), process.env.REMAINING_ARCHIVE);
assert.equal(fileURLToPath(import.meta.resolve('virtual-bash/commands/network')), process.env.REMAINING_NETWORK);
const archives = JSON.parse(readFileSync(new URL('./archives.json', import.meta.url)));
const watchdog = { timeout: 15000 };
const observations = [];

async function inventory(fs, path = '/') {
  const output = {};
  for (const entry of await fs.readdir(path)) {
    const name = `${path === '/' ? '' : path}/${entry.name}`;
    const stat = await fs.lstat(name);
    output[name] = stat.type === 'file' ? hex(await fs.readFile(name)) : stat.type;
    if (stat.type === 'directory') Object.assign(output, await inventory(fs, name));
  }
  return output;
}

async function fixture(context, kind, path, chunks, whole, afterRead) {
  const fs = createMemoryFileSystem();
  if (path.includes('/', 1)) await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await fs.writeFile(path, Buffer.from(whole, 'hex'));
  const originalRead = fs.readStream.bind(fs);
  const sources = [];
  fs.readStream = (name, settings) => {
    assert.ok(settings?.signal, 'VFS source receives cancellation signal');
    settings.signal.throwIfAborted();
    if (name !== path) return originalRead(name, settings);
    const item = borrowed(kind, chunks, afterRead);
    sources.push(item);
    return item.source;
  };
  const shell = new Shell({ fs });
  context.after(async () => { await shell.dispose(); });
  return { shell, fs, sources };
}

function observed(context, result, extra) {
  const observation = { name: context.name, status: result.exitCode, stdout: hex(result.stdoutBytes), stderr: hex(result.stderrBytes), ...extra };
  observations.push(observation);
  context.diagnostic(JSON.stringify(observation));
  return observation;
}

function expectedResult(result, stdout = '', stderr = '', status = 0) {
  assert.deepEqual({ status: result.exitCode, stdout: hex(result.stdoutBytes), stderr: hex(result.stderrBytes) }, { status, stdout, stderr: hex(Buffer.from(stderr)) });
}

function sourcesComplete(sources, chunks, count = 1) {
  assert.equal(sources.length, count, 'exact named VFS stream openings');
  for (const item of sources) complete(item.state, chunks);
}

function finding(route, observation, expected, retention) {
  const marker = '/tmp/byte-remaining-consumers-findings.txt';
  const prefix = existsSync(marker) ? readFileSync(marker, 'utf8') + '\n' : '';
  const text = prefix + JSON.stringify({ route, observation, expected, retention, candidate: process.env.REMAINING_CANDIDATE,
    contract: 'ByteSource/readStream next-read reuse; no transfer stated. Generator overwrites only on resumed next or finalizer. Transport copies uploads and never mutates request buffers.',
    repro: commands[route], source: 'frozen public.mjs + vectors.mjs; Buffer offset 7, empty views, finalizer zero-fill; paired Uint8Array control',
    action: 'NO product edits. Stop expansion; finish only precommitted 24-row matrix.' }, null, 2) + '\n';
  const operation = existsSync(marker) ? `*** Delete File: ${marker}\n*** Add File: ${marker}` : `*** Add File: ${marker}`;
  const patch = `*** Begin Patch\n${operation}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

for (const kind of ['Buffer', 'Uint8Array']) {
  for (const route of ['raw', 'json', 'program']) {
    test(`jq ${route} ${kind}`, watchdog, async context => {
      const vector = vectors[route];
      const path = route === 'program' ? '/program' : '/input';
      const { shell, fs, sources } = await fixture(context, kind, path, vector.chunks, vector.whole);
      if (route === 'program') await fs.writeFile('/input', Buffer.from('{"x":7}\n'));
      const before = await inventory(fs);
      shell.use(structuredCommands());
      const result = await shell.exec(commands[route]);
      const actual = observed(context, result, { files: await inventory(fs), sources: sources.map(item => item.state) });
      sourcesComplete(sources, vector.chunks);
      assert.deepEqual(actual.files, before);
      if (route === 'program' && kind === 'Buffer' && (result.exitCode !== 0 || hex(result.stdoutBytes) !== vector.output)) {
        finding(route, actual, { status: 0, stderr: '', stdout: vector.output, files: before }, 'src/commands/structured/jq.ts:81 chunks.push(chunk.slice()) retains Buffer aliases until source completion');
      }
      expectedResult(result, vector.output);
    });
  }

  for (const route of ['context', 'binary']) {
    test(`rg ${route} ${kind}`, watchdog, async context => {
      const vector = vectors[route];
      const { shell, fs, sources } = await fixture(context, kind, '/input', vector.chunks, vector.whole);
      const before = await inventory(fs);
      shell.use(searchCommands());
      const result = await shell.exec(commands[route]);
      const actual = observed(context, result, { files: await inventory(fs), sources: sources.map(item => item.state) });
      sourcesComplete(sources, vector.chunks);
      assert.deepEqual(actual.files, before);
      expectedResult(result, vector.output);
    });
  }

  for (const route of ['tarPlain', 'tarGzip', 'tarCreate']) {
    test(`tar ${route} ${kind}`, watchdog, async context => {
      const creating = route === 'tarCreate';
      const whole = creating ? vectors.payload.whole : archives[route === 'tarGzip' ? 'gzip' : 'plain'];
      const chunks = creating ? vectors.payload.chunks : splitArchive(Buffer.from(whole, 'hex'));
      const path = creating ? '/in/payload' : '/archive';
      const { shell, fs, sources } = await fixture(context, kind, path, chunks, whole);
      await fs.mkdir('/out');
      const before = await inventory(fs);
      shell.use(archiveCommands({ limits: { chunkSize: 512 } }));
      const result = await shell.exec(commands[route]);
      const actual = observed(context, result, { files: await inventory(fs), sources: sources.map(item => item.state) });
      sourcesComplete(sources, chunks);
      expectedResult(result);
      assert.deepEqual(actual.files, { ...before, '/out/payload': vectors.payload.whole });
    });
  }

  for (const route of ['download', 'upload', 'replay']) {
    test(`curl ${route} ${kind}`, watchdog, async context => {
      const vector = vectors.payload;
      const { shell, fs, sources } = await fixture(context, kind, '/upload', vector.chunks, vector.whole);
      const before = await inventory(fs);
      const response = borrowed(kind, vector.chunks);
      const calls = [];
      const authorizations = [];
      const disposals = [];
      shell.use(networkCommands({
        authorize(request) {
          request.signal.throwIfAborted();
          authorizations.push({ url: request.url, method: request.method, attempt: request.attempt, ...(request.redirectFrom ? { redirectFrom: request.redirectFrom } : {}) });
          return new URL(request.url).origin === 'https://fixture.invalid';
        },
        async transport(request) {
          request.signal.throwIfAborted();
          const copied = [];
          if (request.body) for await (const chunk of request.body) {
            request.signal.throwIfAborted();
            copied.push(new Uint8Array(chunk));
          }
          calls.push({ url: request.url, method: request.method, body: hex(Buffer.concat(copied)) });
          const index = calls.length - 1;
          const redirect = route === 'replay' && index === 0;
          disposals.push(0);
          return { status: redirect ? 307 : 200, statusText: redirect ? 'Temporary Redirect' : 'OK',
            headers: redirect ? [['location', '/next']] : [],
            body: route === 'download' ? response.source : (async function* () {})(),
            async dispose() { disposals[index]++; },
          };
        },
      }));
      const result = await shell.exec(commands[route], route === 'replay' ? { stdin: 'S' } : {});
      const actual = observed(context, result, { calls, authorizations, disposals, files: await inventory(fs), sources: sources.map(item => item.state), response: response.state });
      expectedResult(result);
      sourcesComplete(sources, vector.chunks, route === 'download' ? 0 : 1);
      if (route === 'download') complete(response.state, vector.chunks);
      assert.deepEqual(actual.files, route === 'download' ? { ...before, '/download': vector.whole } : before);
      const expectedCalls = route === 'replay'
        ? [{ url: 'https://fixture.invalid/start', method: 'POST', body: vectors.replay.output }, { url: 'https://fixture.invalid/next', method: 'POST', body: vectors.replay.output }]
        : [{ url: 'https://fixture.invalid/start', method: route === 'upload' ? 'PUT' : 'GET', body: route === 'upload' ? vector.whole : '' }];
      assert.deepEqual(disposals, route === 'replay' ? [1, 1] : [1]);
      assert.deepEqual(authorizations, expectedCalls.map((call, index) => ({ url: call.url, method: call.method, attempt: 0, ...(index ? { redirectFrom: 'https://fixture.invalid/start' } : {}) })));
      if (route === 'replay' && kind === 'Buffer' && JSON.stringify(calls) !== JSON.stringify(expectedCalls)) {
        finding(route, actual, { status: 0, stderr: '', stdout: '', calls: expectedCalls, files: before }, 'src/commands/network/body.ts:142 cache.push(chunk.slice()) retains borrowed VFS Buffer while hasStdin; line 124 replays aliases after finalizer');
      }
      assert.deepEqual(calls, expectedCalls);
    });
  }
}

test('jq cooperative source abort preserves reason identity', watchdog, async context => {
  const controller = new AbortController();
  const reason = new Error('remaining-consumers caller abort');
  const vector = vectors.raw;
  const { shell, fs, sources } = await fixture(context, 'Buffer', '/input', vector.chunks, vector.whole, () => controller.abort(reason));
  const before = await inventory(fs);
  shell.use(structuredCommands());
  const accepted = [];
  await assert.rejects(shell.exec(commands.raw, { signal: controller.signal, stdout: { async write(chunk) { accepted.push(hex(chunk)); } } }), error => error === reason);
  assert.deepEqual(accepted, []);
  assert.deepEqual(await inventory(fs), before);
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0].state, { yielded: 1, resumed: 1, finalized: true, unchangedChecks: 1 });
  context.diagnostic(JSON.stringify({ name: context.name, exactAbortIdentity: true, accepted, files: before, source: sources[0].state }));
});

test('curl response error preserves partial bytes and closes response', watchdog, async context => {
  const reason = new Error('remaining-consumers response failure');
  const vector = vectors.payload;
  const response = borrowed('Buffer', vector.chunks, () => { throw reason; });
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  context.after(async () => { await shell.dispose(); });
  let disposed = 0;
  let authorized = 0;
  shell.use(networkCommands({ authorize(request) { request.signal.throwIfAborted(); authorized++; return request.url === 'https://fixture.invalid/start'; },
    async transport() { return { status: 200, statusText: 'OK', headers: [], body: response.source, async dispose() { disposed++; } }; },
  }));
  const result = await shell.exec('curl -sS https://fixture.invalid/start');
  const actual = observed(context, result, { disposed, authorized, files: await inventory(fs), source: response.state });
  expectedResult(result, 'a0ff', 'curl: (56) Network transfer failed\n', 56);
  assert.equal(disposed, 1);
  assert.equal(authorized, 1);
  assert.deepEqual(actual.files, {});
  assert.deepEqual(response.state, { yielded: 1, resumed: 1, finalized: true, unchangedChecks: 1 });
});

after(() => {
  console.log('REMAINING_CLOSURE ' + JSON.stringify({ resources: process.getActiveResourcesInfo(), observedResults: observations.length,
    scope: 'All Shell context.after disposals awaited; no servers, sockets, subprocess product commands or external network. Child hard timeout covers natural process closure.' }));
});
