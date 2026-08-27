import assert from 'node:assert/strict';
import { assertPositiveDepthFailure } from '../n18-predicate.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases, environment, fixtures } from './corpus.mjs';
import { captureSink, deferred, fixtureFileSystem } from './fixture-fs.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const pause = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds));
async function bounded(promise, label, milliseconds = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`HARNESS TIMEOUT: ${label}`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}
function failed(outcome) { assert.ok(outcome.rejected || outcome.result?.exitCode !== 0, 'failure must not become success'); }
function successful(outcome) { assert.equal(outcome.rejected, false, String(outcome.error)); assert.equal(outcome.result.exitCode, 0); }
const readMetadataOnly = (calls) => {
  for (const call of calls) assert.ok(['stat', 'lstat', 'readdir', 'readlink', 'realpath', 'access'].includes(call.method), `unexpected operation ${call.method}`);
};
function realFixture(bridge) {
  assert.equal(typeof bridge.createRealFileSystem, 'function', 'actual configured real adapter required');
  const target = bridge.createRealFileSystem(join(directory, 'native-fixtures'));
  const calls = [];
  const filesystem = new Proxy(target, { get(object, property) {
    const value = Reflect.get(object, property, object);
    if (typeof value !== 'function') return value;
    return (...args) => {
      calls.push({ method: property, path: args[0], signal: args[property === 'access' ? 2 : 1]?.signal });
      readMetadataOnly(calls);
      return value.apply(object, args);
    };
  } });
  return { filesystem, calls };
}
function start(bridge, options = {}) {
  const controller = options.controller ?? new AbortController();
  const fixture = options.fixture ?? fixtureFileSystem(bridge.makeFsError, options.configuration);
  const stdout = options.stdout ?? captureSink();
  const stderr = captureSink();
  const context = {
    command: 'tree', args: options.argv ?? ['basic'], cwd: '/', env: { ...environment },
    fs: options.fs ?? fixture.filesystem, signal: controller.signal,
    stdin: options.stdin ?? (async function* () {})(), stdinIsDefault: options.stdinIsDefault ?? true,
    stdout: stdout.sink, stderr: stderr.sink,
  };
  let settled = false;
  const outcome = Promise.resolve().then(() => {
    const definition = bridge.createCommand(options.limits ?? {});
    assert.equal(definition.name, 'tree');
    return definition.execute(context);
  }).then((result) => ({ rejected: false, result }), (error) => ({ rejected: true, error })).finally(() => { settled = true; });
  return { controller, fixture, stdout, stderr, context, outcome, settled: () => settled };
}
async function finish(run) {
  const outcome = await bounded(run.outcome, 'command settlement');
  await pause(5);
  run.stdout.verifyOwnership();
  run.stderr.verifyOwnership();
  readMetadataOnly(run.fixture.calls);
  return outcome;
}
async function nativeCase(bridge, entry, original) {
  const fixture = entry.id === 'N01' ? realFixture(bridge) : undefined;
  const run = start(bridge, { argv: entry.argv, fixture });
  const outcome = await finish(run);
  assert.equal(outcome.rejected, false, String(outcome.error));
  if (entry.comparison === 'status-and-diagnostic') {
    assert.notEqual(outcome.result.exitCode, 0);
    const text = Buffer.concat([run.stdout.bytes(), run.stderr.bytes()]).toString();
    assert.ok(text.length > 0);
    if (entry.id === 'N17') assert.match(text, /missing-root/u);
    if (entry.id === 'N18') assertPositiveDepthFailure({ exitCode: outcome.result.exitCode, stdout: run.stdout.bytes(), stderr: run.stderr.bytes() });
  } else if (entry.comparison === 'ancestor-alias-invariant') {
    successful(outcome);
    assert.equal((run.stdout.bytes().toString().match(/leaf\.txt/gu) ?? []).length, 4, 'three expanded leaves plus file-link target spelling');
    assert.doesNotMatch(run.stdout.bytes().toString(), /alias-b[^\n]*(?:recursive|cycle)/iu);
  } else {
    assert.equal(outcome.result.exitCode, original.exitCode);
    assert.deepEqual(run.stderr.bytes(), Buffer.from(original.stderrBase64, 'base64'));
    if (entry.comparison === 'json') assert.deepEqual(JSON.parse(run.stdout.bytes()), JSON.parse(Buffer.from(original.stdoutBase64, 'base64')));
    else assert.deepEqual(run.stdout.bytes(), Buffer.from(original.stdoutBase64, 'base64'));
  }
  if (entry.id === 'N08') assert.ok(!run.fixture.calls.some((call) => call.method === 'readdir' && call.path.startsWith('/basic/skip-dir')));
  if (entry.id === 'N03' || entry.id === 'N04') {
    const depth = entry.id === 'N03' ? 1 : 2;
    for (const call of run.fixture.calls.filter((item) => item.method === 'readdir')) assert.ok(call.path.split('/').filter(Boolean).length <= depth, 'no readdir beyond display boundary');
  }
  return { exitCode: outcome.result.exitCode, stdoutBytes: run.stdout.bytes().length, stderrBytes: run.stderr.bytes().length, fsCalls: run.fixture.calls.length, comparison: entry.comparison };
}
async function seedMemory(bridge) {
  const fs = bridge.createMemoryFileSystem();
  for (const root of ['basic', 'controls']) {
    await fs.mkdir(`/${root}`, { recursive: true });
    for (const [kind, name, value] of fixtures[root]) {
      const destination = `/${root}/${name}`;
      if (kind === 'd') await fs.mkdir(destination, { recursive: true });
      else await fs.writeFile(destination, new TextEncoder().encode(value));
    }
  }
  return fs;
}
async function adversarialCase(bridge, entry, profile) {
  const scenario = entry.scenario;
  if (['scoped-collision', 'unknown-finite', 'missing-realpath'].includes(scenario)) {
    const run = start(bridge, { argv: ['finite'], configuration: { identity: scenario === 'scoped-collision' ? 'disjoint' : 'unknown', noRealpath: true, missingRealpath: scenario === 'missing-realpath' } });
    const outcome = await finish(run);
    if (scenario === 'missing-realpath') {
      assert.ok(run.fixture.calls.length < 160);
      return { characterization: outcome.rejected ? 'rejected' : outcome.result.exitCode, stdout: run.stdout.bytes().toString() };
    }
    successful(outcome);
    assert.match(run.stdout.bytes().toString(), /leaf-marker\.txt/u);
    assert.doesNotMatch(run.stdout.bytes().toString(), /recursive|cycle/iu);
    return { fsCalls: run.fixture.calls.length };
  }
  if (scenario === 'unknown-loop') {
    const run = start(bridge, { argv: ['-l', 'cycle'], configuration: { identity: 'unknown', noRealpath: true }, limits: { entries: 12 } });
    const outcome = await finish(run);
    assert.ok(run.fixture.calls.length < 160, 'product must bound walk before harness guard');
    assert.ok(run.stdout.bytes().length < 16384);
    assert.ok(!outcome.rejected || outcome.error?.syscall !== 'readdir' || outcome.error?.code !== 'EFBIG');
    const output = Buffer.concat([run.stdout.bytes(), run.stderr.bytes()]).toString();
    assert.ok(output.length > 0 || outcome.rejected, 'explicit bounded/cycle outcome');
    return { fsCalls: run.fixture.calls.length, exitCode: outcome.result?.exitCode, rejected: outcome.rejected };
  }
  if (scenario === 'malicious-names' || scenario === 'duplicate-names') {
    const names = scenario === 'malicious-names' ? ['..', '.', '', '/outside', '../outside', 'child/../../outside', 'nul\0name'] : Array(30).fill('child');
    const run = start(bridge, { argv: ['finite'], limits: scenario === 'duplicate-names' ? { entries: 8 } : {}, configuration: {
      listing: (actual, entries) => actual === '/finite' ? [...names.map((name) => ({ name, type: 'directory' })), ...entries] : entries,
    } });
    const outcome = await finish(run);
    const escaped = run.fixture.calls.filter((call) => call.path !== '/finite' && !call.path.startsWith('/finite/'));
    return { characterization: outcome.rejected ? 'rejected' : outcome.result.exitCode, escapedCalls: escaped, fsCalls: run.fixture.calls.length, boundarySafe: escaped.length === 0 && run.fixture.calls.length < 160 };
  }
  if (scenario === 'permission' || scenario === 'late-error') {
    const denied = scenario === 'permission' ? '/errors' : '/errors/z-denied';
    const code = scenario === 'permission' ? 'EACCES' : 'EIO';
    const run = start(bridge, { argv: ['errors'], configuration: { before: (call) => {
      if (call.path === denied && call.method === 'readdir') throw bridge.makeFsError(code, { path: denied, syscall: 'readdir' });
    } } });
    const outcome = await finish(run);
    failed(outcome);
    const diagnostics = Buffer.concat([run.stdout.bytes(), run.stderr.bytes()]).toString();
    if (!outcome.rejected) {
      assert.match(diagnostics, scenario === 'permission' ? /permission|denied/iu : /input\/output|I\/O|EIO/iu);
      assert.match(diagnostics, scenario === 'permission' ? /errors/u : /z-denied/u);
    } else assert.equal(outcome.error.code, code);
    return { exitCode: outcome.result?.exitCode, acceptedBytes: run.stdout.bytes().length, diagnostics };
  }
  if (scenario === 'pre-abort') {
    const controller = new AbortController();
    const reason = bridge.makeFsError('ENOENT', { path: '/not-a-path-failure', syscall: 'abort' });
    controller.abort(reason);
    const run = start(bridge, { controller });
    const outcome = await finish(run);
    failed(outcome);
    if (outcome.rejected) assert.equal(outcome.error, reason);
    assert.equal(run.fixture.calls.length, 0);
    assert.equal(run.stdout.bytes().length, 0);
    return { rejected: outcome.rejected, exitCode: outcome.result?.exitCode };
  }
  if (scenario === 'pending-fs' || scenario === 'pending-sink') {
    const entered = deferred();
    const gate = deferred();
    const unhandled = [];
    const observe = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', observe);
    let run;
    try {
      run = start(bridge, scenario === 'pending-fs' ? { configuration: { before: (call) => {
        if (call.method === 'readdir') { entered.resolve(call); return gate.promise; }
      } } } : { stdout: captureSink({ before: () => { entered.resolve(); return gate.promise; } }) });
      const call = await bounded(entered.promise, 'pending operation begins');
      if (call) assert.equal(call.signal, run.controller.signal);
      const reason = bridge.makeFsError('ENOENT', { path: '/cancel-pending', syscall: 'abort' });
      run.controller.abort(reason);
      const outcome = await finish(run);
      failed(outcome);
      if (outcome.rejected) assert.equal(outcome.error, reason);
      const callCount = run.fixture.calls.length;
      gate.reject(new Error('deliberate late host rejection'));
      await pause(25);
      assert.equal(unhandled.length, 0);
      assert.equal(run.fixture.calls.length, callCount);
      return { rejected: outcome.rejected, exitCode: outcome.result?.exitCode, lateUnhandled: unhandled.length };
    } finally {
      gate.reject(new Error('verifier release after pending probe'));
      await pause(10);
      process.off('unhandledRejection', observe);
    }
  }
  if (scenario === 'backpressure') {
    const entered = deferred();
    const gate = deferred();
    const stdout = captureSink({ before: ({ index }) => { if (index === 1) { entered.resolve(); return gate.promise; } } });
    const run = start(bridge, { stdout });
    try {
      await bounded(entered.promise, 'first sink write');
      await pause(25);
      assert.equal(run.settled(), false);
      assert.equal(stdout.statistics().writes, 1);
      gate.resolve();
      successful(await finish(run));
      assert.equal(stdout.statistics().maxActive, 1);
      return stdout.statistics();
    } finally { gate.resolve(); }
  }
  if (scenario === 'output-limit' || scenario === 'entry-limit') {
    const run = start(bridge, { argv: ['wide'], limits: scenario === 'output-limit' ? { outputBytes: 64 } : { entries: 8 } });
    const outcome = await finish(run);
    failed(outcome);
    if (scenario === 'output-limit') assert.ok(run.stdout.bytes().length <= 64, 'UTF-8 byte budget, not codepoint count');
    else assert.ok((run.stdout.bytes().toString().match(/entry-\d{3}/gu) ?? []).length <= 8);
    assert.ok(run.fixture.calls.length < 100);
    return { exitCode: outcome.result?.exitCode, acceptedBytes: run.stdout.bytes().length, fsCalls: run.fixture.calls.length };
  }
  if (scenario === 'signals' || scenario === 'stdin-unread') {
    const poison = { [Symbol.asyncIterator]() { throw new Error('tree must not consume stdin'); } };
    const run = start(bridge, { argv: scenario === 'signals' ? ['-l', 'links'] : ['basic'], fixture: scenario === 'stdin-unread' ? realFixture(bridge) : undefined, stdin: poison, stdinIsDefault: false });
    successful(await finish(run));
    assert.ok(run.fixture.calls.some((call) => call.method === 'readdir'));
    for (const call of run.fixture.calls) assert.equal(call.signal, run.controller.signal, `${call.method} signal`);
    return { fsCalls: run.fixture.calls.length };
  }
  if (scenario === 'shell-pipeline') {
    const fs = await seedMemory(bridge);
    const useJson = ['native-json-schema', 'no-report'].every((feature) => profile.supportedFeatures.includes(feature));
    let consumerCalls = 0;
    const names = [];
    const consumer = { name: 'holdout-json-names', async execute(context) {
      consumerCalls++;
      assert.equal(context.stdinIsDefault, false);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of context.stdin) { bytes += chunk.length; assert.ok(bytes < 65536); chunks.push(Buffer.from(chunk)); }
      if (useJson) {
        const documents = JSON.parse(Buffer.concat(chunks));
        for (const child of documents[0].contents) names.push(child.name);
      } else {
        const text = Buffer.concat(chunks).toString();
        for (const expected of ['basic', 'Alpha.txt', 'last.txt']) assert.ok(text.includes(expected));
        assert.ok(!text.includes('.hidden.txt') && !text.includes('private.txt'));
      }
      await context.stdout.write(new TextEncoder().encode(useJson ? `${JSON.stringify(names.sort())}\n` : 'consumed-tree-output\n'));
      return { exitCode: 0 };
    } };
    const relay = { name: 'holdout-relay', async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(new Uint8Array(chunk));
      return { exitCode: 0 };
    } };
    const result = await bounded(bridge.executeShell({ fs, commands: [bridge.createCommand({}), consumer, relay], env: environment,
      script: `(${useJson ? 'tree -J --noreport controls' : 'tree basic'} | holdout-json-names) > /saved.json; holdout-relay < /saved.json`, signal: new AbortController().signal }), 'actual Shell pipeline');
    assert.equal(result.exitCode, 0);
    assert.equal(consumerCalls, 1);
    const expected = useJson ? `${JSON.stringify(fixtures.controls.map((item) => item[1]).sort())}\n` : 'consumed-tree-output\n';
    assert.equal(new TextDecoder().decode(result.stdout), expected);
    assert.equal(new TextDecoder().decode(await fs.readFile('/saved.json')), expected);
    assert.equal(new TextDecoder().decode(result.stderr), '');
    return { consumerCalls, names: names.length, actualShellRequired: true, format: useJson ? 'native-json' : 'text', jsonCoverage: useJson ? 'executed' : 'unsupported-not-pass' };
  }
  if (scenario === 'sink-failure') {
    const reason = bridge.makeFsError('EPIPE', { syscall: 'holdout-sink' });
    const accepted = [];
    const stdout = captureSink({ before: ({ chunk }) => { accepted.push(chunk.subarray(0, Math.min(7, chunk.length))); throw reason; } });
    const run = start(bridge, { stdout });
    const outcome = await finish(run);
    failed(outcome);
    if (outcome.rejected) assert.equal(outcome.error, reason);
    assert.equal(stdout.statistics().writes, 1);
    assert.ok(Buffer.concat(accepted).length > 0);
    return { partialEffectBytes: Buffer.concat(accepted).length, exitCode: outcome.result?.exitCode };
  }
  throw new Error(`Unimplemented sealed scenario: ${scenario}`);
}

if (process.argv[2] === '--list') {
  console.log(JSON.stringify(cases.map(({ id, title, requires, classification }) => ({ id, title, requires, classification })), null, 2));
} else if (process.argv[2] === '--execute') {
  assert.equal(process.env.TREE_HOLDOUT_ROOT_RESUMED, 'AUTHOR_FINISHED', 'PREP embargo: explicit root resume required');
  assert.ok(process.argv[3] && process.argv[4], 'usage: --execute bridge.mjs documented-profile.json [case-id]');
  const profile = JSON.parse(await readFile(resolve(process.argv[4]), 'utf8'));
  assert.ok(profile.candidateSourceHash && profile.authorFinishedEvidence && profile.supportedProfileEvidence, 'freeze candidate and supported profile before holdout execution');
  const bridge = await import(pathToFileURL(resolve(process.argv[3])).href);
  const native = JSON.parse(await readFile(join(directory, 'native.json'), 'utf8'));
  const selected = process.argv[5] ? cases.filter((entry) => entry.id === process.argv[5]) : cases;
  assert.ok(selected.length > 0, 'case selection must exist');
  for (const entry of selected) {
    const missing = entry.requires.filter((feature) => !profile.supportedFeatures.includes(feature));
    if (missing.length) { console.log(JSON.stringify({ id: entry.id, status: 'unsupported-not-pass', missing })); continue; }
    try {
      const evidence = entry.kind === 'native' ? await nativeCase(bridge, entry, native.find((result) => result.id === entry.id)) : await adversarialCase(bridge, entry, profile);
      const exploratory = entry.classification?.includes('exploration');
      console.log(JSON.stringify({ id: entry.id, status: exploratory ? 'characterized-not-pass' : 'pass', evidence }));
    } catch (error) {
      process.exitCode = 1;
      console.log(JSON.stringify({ id: entry.id, status: 'fail', error: { name: error.name, message: error.message, stack: error.stack } }));
    }
  }
} else {
  console.log('PREP ONLY. Run node --test selftest.mjs to validate verifier/oracle fixtures without importing any product. Execution requires root resume, candidate identity, bridge, and supported-profile evidence.');
}
