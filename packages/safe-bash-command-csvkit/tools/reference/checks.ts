// Explicitly invoked tooling checks; intentionally outside canonical unit discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCapture, buildCoverage, validateRequest, qualifyProfile } from './model.js';
import { collectProcess } from './process.js';
import { snapshot } from './snapshot.js';
import { Volume, createFsFromVolume } from 'memfs';

const bytes = (value: string) => Buffer.from(value).toString('base64');
const observation = {
  profileId: 'frozen', profileQualified: true,
  stdoutBase64: bytes('a,b\r\n'), stderrBase64: bytes('/frozen/source.py:1: warning\n'),
  status: 0, signal: null, timedOut: false,
  filesBefore: [], filesAfter: [{ path: 'result.csv', kind: 'file', bytesBase64: bytes('a,b\n') }],
  database: { qualification: 'unmeasured' }, interactive: { qualification: 'unmeasured' }
};

test('exact bytes, status and files compare without stderr path normalization', () => {
  assert.equal(compareCapture(observation, structuredClone(observation)).exact, true);
  for (const changed of [
    { stdoutBase64: bytes('a,b\n') }, { stderrBase64: bytes('/other/source.py:1: warning\n') },
    { status: 1 }, { signal: 'SIGPIPE' }, { filesAfter: [] }, { profileId: 'other' },
    { filesAfter: [{ ...observation.filesAfter[0], bytesBase64: bytes('a,b\r\n') }] }
  ]) assert.equal(compareCapture(observation, { ...observation, ...changed }).exact, false);
});

test('malformed or missing capture fields never pass by equality', () => {
  for (const changed of [{ stdoutBase64: '!!!' }, { stderrBase64: undefined }, { profileId: undefined }, { profileQualified: undefined }, { status: undefined }, { timedOut: undefined }, { filesBefore: undefined }]) {
    const malformed = { ...observation, ...changed } as unknown as Parameters<typeof compareCapture>[0];
    assert.equal(compareCapture(malformed, malformed).exact, false);
  }
});

test('identical timeout captures cannot pass', () => {
  const capture = { ...observation, timedOut: true };
  assert.equal(compareCapture(capture, capture).exact, false);
  for (const changed of [{ outputLimitExceeded: true }, { profileQualified: false }, { captureComplete: false }, { status: null }]) {
    const incomplete = { ...observation, ...changed };
    assert.equal(compareCapture(incomplete, incomplete).exact, false);
  }
});

test('unmeasured structured semantics never become passes from exact byte comparisons', () => {
  const compared = compareCapture(observation, observation);
  assert.equal(compared.database, 'unmeasured');
  assert.equal(compared.interactive, 'unmeasured');
  assert.equal(compared.fullSupport, false);
});

test('capture requires explicit argv/env/pipe profile and original executable name', () => {
  const request = { id: 'example', command: 'csvcut', argv: ['-c', '1'], stdinBase64: bytes('a,b\n1,2\n'), env: {}, tty: false, timeoutMs: 1000 };
  assert.doesNotThrow(() => validateRequest(request, ['csvcut']));
  for (const changed of [{ command: 'csvkit' }, { env: undefined }, { tty: true }, { stdinBase64: '!!!' }, { argv: ['\0'] }, { timeoutMs: 0 }]) {
    assert.throws(() => validateRequest({ ...request, ...changed }, ['csvcut']));
  }
});

test('coverage retains every option, branch, upstream declaration and unresolved assignment', () => {
  const features = { commands: [{ name: 'csvcut', overrideFlags: ['I'], defaults: '{}', actions: [{ dest: 'columns', default: null, optionStrings: ['-c'] }] }], parserDeclarations: [{ path: 'a.py', line: 1 }], sourceBranches: [{ path: 'a.py', line: 1, condition: 'x' }] };
  const census = { files: [{ package: 'csvkit', path: 'tests/a.py', tests: [{ qualifiedName: 'A.test_x', line: 2, blocker: 'UNPORTED' }], staticTestAssignments: [{ name: 'generated' }] }] };
  const result = buildCoverage(features, census);
  assert.equal(result.options.length, 1);
  assert.equal(result.parsers.length, 1);
  assert.deepEqual(result.commands[0]?.overrideFlags, ['I']);
  assert.equal(result.branches.length, 1);
  assert.equal(result.upstreamFiles.length, 1);
  assert.equal(result.upstreamFiles[0]?.tests.length, 1);
  assert.equal(result.upstreamFiles[0]?.staticTestAssignments.length, 1);
  assert.equal(result.denominators.testDeclarations, 1);
  assert.equal(result.denominators.staticAssignments, 1);
  assert.equal(result.qualifiedPasses, 0);
  assert.equal(result.fullSupport, false);
});

test('profile qualification refuses distribution drift, missing drivers and executable drift', () => {
  const expected = { runtime: { executableSha256: 'python', version: '3.14.2' }, distributions: [{ name: 'agate', version: '1.14.2', installedFileManifestSha256: 'files' }] };
  const actual = structuredClone(expected);
  assert.equal(qualifyProfile(expected, actual).qualified, true);
  for (const changed of [
    { ...actual, distributions: [] },
    { ...actual, distributions: [{ ...actual.distributions[0]!, installedFileManifestSha256: 'changed' }] },
    { ...actual, runtime: { ...actual.runtime, executableSha256: 'different' } }
  ]) assert.equal(qualifyProfile(expected, changed).qualified, false);
});

test('profile qualification retains locale and pipe buffering metadata', () => {
  const expected = { runtime: { executableSha256: 'python', version: '3.14.2', implementation: 'CPython', platform: 'frozen' }, distributions: [], locale: { all: 'C' }, stdio: { stdout: { lineBuffering: false } } };
  assert.equal(qualifyProfile(expected, structuredClone(expected)).qualified, true);
  assert.equal(qualifyProfile(expected, { ...expected, locale: { all: 'en_US.UTF-8' } }).qualified, false);
  assert.equal(qualifyProfile(expected, { ...expected, stdio: { stdout: { lineBuffering: true } } }).qualified, false);
});

test('a pinned executable must be the frozen csvkit distribution script', () => {
  const expected = { runtime: { executableSha256: 'python', version: '3.14.2' }, distributions: [], executable: { name: 'csvcut', sha256: 'frozen-csvcut-script' } };
  assert.equal(qualifyProfile(expected, structuredClone(expected)).qualified, true);
  assert.equal(qualifyProfile(expected, { ...expected, executable: { name: 'csvcut', sha256: 'unrelated-script' } }).qualified, false);
});

test('native collector owns reusable byte fragments and exact exit/signal', async () => {
  const buffer = new Uint8Array([65]);
  const source = { async *[Symbol.asyncIterator]() { yield buffer; buffer[0] = 66; yield buffer; } };
  let input: Uint8Array | undefined;
  const result = await collectProcess({ stdout: source, stderr: { async *[Symbol.asyncIterator]() { yield new Uint8Array([67]); } }, completion: Promise.resolve({ status: 7, signal: null }), async writeInput(value) { input = value; }, kill() { throw new Error('unexpected kill'); } }, new Uint8Array([90]), 1000, 100);
  assert.equal(result.stdoutBase64, bytes('AB'));
  // Each stream owns fragments before requesting the next producer fragment.
  assert.equal(result.stderrBase64, bytes('C'));
  assert.equal(result.status, 7);
  assert.deepEqual(input, new Uint8Array([90]));
});

test('collector cap is not a successful shortened capture', async () => {
  let killed = false;
  const result = await collectProcess({ stdout: { async *[Symbol.asyncIterator]() { yield new Uint8Array(4); } }, stderr: { async *[Symbol.asyncIterator]() {} }, completion: Promise.resolve({ status: null, signal: 'SIGKILL' }), async writeInput() {}, kill() { killed = true; } }, new Uint8Array(), 1000, 2);
  assert.equal(killed, true);
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.stdoutBase64, '');
});

test('snapshots preserve exact bytes and empty directories in memfs, rejecting links', async () => {
  const volume = Volume.fromJSON({ '/case/input.csv': 'a\r\n', '/case/empty': null });
  const fs = createFsFromVolume(volume).promises as unknown as Parameters<typeof snapshot>[1];
  const files = await snapshot('/case', fs, 100);
  assert.deepEqual(files, [
    { path: 'empty', kind: 'directory' },
    { path: 'input.csv', kind: 'file', bytesBase64: bytes('a\r\n'), sha256: '8e4621379786ef42a4fec155cd525c291dd7db3c1fde3478522f4f61c03fd1bd' }
  ]);
  await assert.rejects(snapshot('/case', fs, 1));
  volume.symlinkSync('/case/input.csv', '/case/link');
  await assert.rejects(snapshot('/case', fs, 100));
});
