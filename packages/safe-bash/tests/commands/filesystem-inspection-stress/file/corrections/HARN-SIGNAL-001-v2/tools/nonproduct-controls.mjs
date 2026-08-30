import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(await readFile(join(root, 'v2-correction.json')));
const v1 = await readFile(join(root, 'history/v1-corrected-observed-runner.mjs'), 'utf8');
const observationOnly = await readFile(join(root, 'runner/v2-observation-only-runner.mjs'), 'utf8');
const v2 = await readFile(join(root, 'runner/v2-runner.mjs'), 'utf8');
const fixtureManifest = JSON.parse(await readFile('/tmp/safe-bash-file-holdout.KyVGrl0A/fixture-manifest.json'));
const png = new Uint8Array(Buffer.from(fixtureManifest.find((entry) => entry.id === 'F09').base64, 'base64'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const observations = [];
const extractCase = (source) => {
  const start = source.indexOf("  await record('F29', async (row) => {");
  const end = source.indexOf("  for (const [id, unknown] of [['F30', false], ['F31', true]])", start);
  assert(start >= 0 && end > start);
  const block = source.slice(start, end);
  return { start, end, block, body: block.slice(block.indexOf('\n') + 1, block.lastIndexOf('  });')) };
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compile = (source) => new AsyncFunction('assert', 'makeFs', 'fixture', 'fileEntry', 'invoke', 'successful', 'stdout', 'traceJson', 'row', extractCase(source).body);
const runV1Mock = compile(v1);
const runV2Mock = compile(v2);

async function mockLifecycle(run, configuration = {}) {
  const caller = new AbortController();
  const cleanup = new AbortController();
  const cleanupReason = new Error('successful invocation-owned cleanup');
  let signal = AbortSignal.any([caller.signal, cleanup.signal]);
  if (configuration.signal === 'already-aborted') cleanup.abort(new Error('already aborted at entry'));
  if (configuration.signal === 'missing') signal = undefined;
  if (configuration.signal === 'wrong-reason') Object.defineProperty(signal, 'reason', { value: new Error('invalid active-signal reason negative control') });
  if (configuration.signal === 'not-a-signal') signal = { aborted: false, reason: undefined };
  const calls = [];
  const forwardedPromises = [];
  const row = { evidence: {} };
  let capturedFs;
  const promise = (value) => {
    const result = Promise.resolve(value);
    forwardedPromises.push(result);
    return result;
  };
  const makeFs = (entries, hooks) => {
    assert.equal(hooks.readFileOnly, true);
    assert.deepEqual(entries['/input'].bytes, png);
    const fs = {
      capabilities: { streamingRead: false },
      lstat(path, options) {
        calls.push({ method: 'lstat', path, options });
        return promise({ type: 'file', size: png.length, mode: 0o644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 });
      },
      readFile(path, options) {
        calls.push({ method: 'readFile', path, options });
        if (options?.maxBytes !== undefined && png.length > options.maxBytes) throw new Error('mock original whole-file maxBytes guard');
        return promise(new Uint8Array(png));
      },
    };
    capturedFs = fs;
    return { fs, trace: calls };
  };
  const invoke = async (fs, args) => {
    assert.deepEqual(args, ['-b', '--mime', '/input']);
    assert.notEqual(fs, undefined);
    const metadataOptions = signal === undefined ? {} : { signal };
    const metadataPromise = fs.lstat('/input', metadataOptions);
    assert.equal(metadataPromise, forwardedPromises.at(-1), 'Observation wrapper returns the SAME original promise');
    assert.equal(calls.at(-1).options, metadataOptions, 'Observation wrapper forwards the original options object');
    await metadataPromise;
    if (!configuration.skipRead) {
      const readOptions = { ...metadataOptions, maxBytes: configuration.maxBytes ?? 65536 };
      const bytesPromise = fs.readFile('/input', readOptions);
      assert.equal(bytesPromise, forwardedPromises.at(-1));
      assert.equal(calls.at(-1).options, readOptions);
      assert.deepEqual(await bytesPromise, png);
    }
    try {
      return { result: { exitCode: configuration.exitCode ?? 0 }, output: configuration.stdout ?? 'image/png; charset=binary\n', errorOutput: configuration.stderr ?? '', context: { signal: caller.signal } };
    } finally {
      if (configuration.abortAfterEntry) cleanup.abort(cleanupReason);
    }
  };
  let error;
  try {
    await run(assert, makeFs, () => ({ bytes: png }), (bytes) => ({ type: 'file', bytes: new Uint8Array(bytes) }), invoke,
      (invocation) => { assert.equal(invocation.result.exitCode, 0); assert.equal(invocation.errorOutput, ''); },
      (invocation) => invocation.output,
      (trace) => trace.map((entry) => ({ method: entry.method, path: entry.path, maxBytes: entry.options?.maxBytes, signalAtSettlement: entry.options?.signal?.aborted })), row);
  } catch (failure) { error = failure; }
  const result = {
    accepted: error === undefined,
    error: error && { name: error.name, message: error.message },
    callerStillActive: !caller.signal.aborted,
    signalAbortedAtSettlement: signal?.aborted,
    snapshots: row.evidence.fsEntrySnapshots?.map((entry) => ({ ...entry, reasonUndefinedAtEntry: entry.reasonAtEntry === undefined })),
    trace: calls.map((entry) => ({ method: entry.method, path: entry.path, maxBytes: entry.options?.maxBytes })),
    unchangedPromiseForwardingChecked: forwardedPromises.length,
    evidence: row.evidence,
  };
  if (!capturedFs && error) throw error;
  assert(capturedFs);
  return result;
}

test('only F29 observation time changes; original and peer history are preserved', () => {
  const old = extractCase(v1);
  const current = extractCase(v2);
  assert.equal(v1.slice(0, old.start), v2.slice(0, current.start));
  assert.equal(v1.slice(old.end), v2.slice(current.end));
  let restored = v2;
  for (const change of [...metadata.assertionChanges].reverse()) restored = restored.replace(change.after, change.before);
  assert.equal(restored, observationOnly);
  for (const change of [...metadata.observationChanges].reverse()) restored = restored.replace(change.after, change.before);
  assert.equal(restored, v1);
  assert.equal(hash(v2), metadata.v2RunnerSha256);
  for (const unchanged of ['successful(invocation);', "assert.equal(stdout(invocation), 'image/png; charset=binary\\n');", "assert(rig.trace.some((entry) => entry.method === 'readFile'));", 'row.evidence.trace = traceJson(rig.trace);']) assert(current.block.includes(unchanged.replace('\\n', '\\n')));
});

test('positive cleanup-aborted-after-entry passes v2 while preserved v1 rejects', async () => {
  const old = await mockLifecycle(runV1Mock, { abortAfterEntry: true });
  const current = await mockLifecycle(runV2Mock, { abortAfterEntry: true });
  assert.equal(old.accepted, false);
  assert.equal(current.accepted, true);
  assert.equal(current.callerStillActive, true);
  assert.equal(current.signalAbortedAtSettlement, true);
  assert.equal(current.snapshots.length, 2);
  for (const entry of current.snapshots) {
    assert.equal(entry.signalPresentAtEntry, true);
    assert.equal(entry.isAbortSignalAtEntry, true);
    assert.equal(entry.abortedAtEntry, false);
    assert.equal(entry.reasonUndefinedAtEntry, true);
  }
  observations.push({ id: 'cleanup-aborted-after-entry', v1: old, v2: current, productExecutions: 0 });
});

test('positive active-at-entry and settlement preserves exact maxBytes and promises', async () => {
  const current = await mockLifecycle(runV2Mock);
  assert.equal(current.accepted, true);
  assert.equal(current.signalAbortedAtSettlement, false);
  assert.equal(current.unchangedPromiseForwardingChecked, 2);
  assert.equal(current.snapshots.find((entry) => entry.method === 'readFile').maxBytesAtEntry, 65536);
  assert.equal(current.trace.find((entry) => entry.method === 'readFile').maxBytes, 65536);
  observations.push({ id: 'active-baseline-forwarding', v2: current, productExecutions: 0 });
});

test('already-aborted entry, missing signal, incorrect reason and duck signal are rejected', async () => {
  for (const signal of ['already-aborted', 'missing', 'wrong-reason', 'not-a-signal']) {
    const current = await mockLifecycle(runV2Mock, { signal });
    assert.equal(current.accepted, false, signal);
    assert.equal(current.error.name, 'AssertionError');
    observations.push({ id: `negative-${signal}`, v2: current, productExecutions: 0, qualification: 'Lifecycle mock intentionally allows invalid host state to reach the harness assertion; not a conforming product/provider claim.' });
  }
});

test('successful PNG/status/stderr/readFile use and original size guard still reject bad controls', async () => {
  for (const [id, configuration] of [
    ['wrong-PNG', { stdout: 'application/octet-stream; charset=binary\n' }],
    ['nonzero-status', { exitCode: 1 }],
    ['nonempty-stderr', { stderr: 'mock error\n' }],
    ['missing-readFile-use', { skipRead: true }],
    ['whole-file-maxBytes-guard', { maxBytes: png.length - 1 }],
  ]) {
    const current = await mockLifecycle(runV2Mock, configuration);
    assert.equal(current.accepted, false, id);
    observations.push({ id: `negative-${id}`, v2: current, productExecutions: 0 });
  }
});

test('F33/F34 remain byte-identical and observation wrapper adds no promise handlers', async () => {
  const start = "  for (const id of ['F33', 'F34'])";
  const end = "  await record('F35'";
  const oldBlock = v1.slice(v1.indexOf(start), v1.indexOf(end));
  const newBlock = v2.slice(v2.indexOf(start), v2.indexOf(end));
  assert.equal(newBlock, oldBlock);
  for (const change of metadata.observationChanges) {
    assert(!change.after.includes('.then('));
    assert(!change.after.includes('.catch('));
  }
  assert(extractCase(v2).block.includes('return Reflect.apply(operation, target, args);'));
  const peer = JSON.parse(await readFile(join(root, 'peer/F29-original-observation.json')));
  assert.equal(peer.observation.postCompletionAccepted, false);
  await writeFile(join(root, 'evidence/nonproduct-observations-corrected.json'), `${JSON.stringify({ recordedAt: new Date().toISOString(), boundary: 'Extracted F29 assertion/observation callback with finite synthetic FS/invocation mocks only. No runner module import, candidate import, classification, Shell, or native call.', productExecutions: 0, nativeCalls: 0, observations }, null, 2)}\n`, { flag: 'wx' });
});
