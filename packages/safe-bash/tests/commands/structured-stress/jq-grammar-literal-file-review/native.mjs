import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const base = 'tests/commands/structured-stress/';
const pins = {
  [`${base}jq-grammar-author-20260827/planned-test-only-changes-v2.json`]: '73b3056266ca0022d079b0d3bcd5b02ff911d806affb8cd0811f95717c177684',
  [`${base}raw-input-native.json`]: '3f582f83c3015317bd53c27ef42290e60c1808ce968e588d8e25edaf3069ff96',
  [`${base}jq-42-independent-review/legacy-native-proof.json`]: '54a844a4e2b3c7f11fd185334f07e6f283250a9f6ddd49a75268eb48bcbd83e3',
  [`${base}capture-raw-input.mjs`]: 'cbfe8243b08fceade229b37e2ceb41d88e02eaf2465d81e5378190dc538f6561',
  [`${base}jq-grammar-proposal-review/REPORT.md`]: '93d2b1c555fb5664a43b308a81a95866dc47ac302c6e00200abcc95b425a3d37',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = {};
for (const [path, expectedHash] of Object.entries(pins)) {
  sourceBytes[path] = await readFile(resolve(root, path));
  assert.equal(digest(sourceBytes[path]), expectedHash, path);
}
const proposal = JSON.parse(sourceBytes[`${base}jq-grammar-author-20260827/planned-test-only-changes-v2.json`]);
const raw = JSON.parse(sourceBytes[`${base}raw-input-native.json`]);
const original = JSON.parse(sourceBytes[`${base}jq-42-independent-review/legacy-native-proof.json`]);
const executable = '/usr/bin/jq';
const executableSha256 = '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f';
assert.equal(digest(await readFile(executable)), executableSha256);
assert.equal(original.executable, executable);
assert.equal(original.executableSha256, executableSha256);
assert.equal(original.rawFixtureSha256, pins[`${base}raw-input-native.json`]);
const environment = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1', PATH: '/usr/bin:/bin' };
assert.deepEqual(environment, original.environment);
const startedAt = new Date().toISOString();
const harnessSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
const expectedOutputs = ['22efbfbdefbfbdefbfbd220a', '22efbfbdefbfbdefbfbd5c6e220a'];
const vectors = ['-Rc', '-Rsc'].map((flags, index) => {
  const id = `file-unicode:${flags}`;
  const rows = proposal.proposal.filter(row => row.oldTestName === `raw native: ${id}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nativeProof.length, 1);
  const proof = rows[0].nativeProof[0];
  const fixtures = raw.cases.filter(fixture => fixture.id === id);
  const originals = original.probes.filter(probe => probe.id === id);
  assert.equal(fixtures.length, 1);
  assert.equal(originals.length, 1);
  const fixture = fixtures[0];
  assert.deepEqual(fixture.argv, [flags, '.', 'unicode-start', '-']);
  assert.equal(fixture.inputHex, '98800a');
  assert.deepEqual(fixture.files, [{ path: 'unicode-start', inputHex: 'f09f' }]);
  const vector = { argv: fixture.argv, inputHex: fixture.inputHex, files: { 'unicode-start': 'f09f' } };
  for (const source of [proof, originals[0]]) {
    assert.deepEqual({ argv: source.argv, inputHex: source.inputHex, files: source.files }, vector);
    assert.deepEqual(source.expected, source.historicalExpected);
    assert.deepEqual(source.expected, { status: fixture.status, stdoutHex: Buffer.from(fixture.stdout).toString('hex'), stderrHex: Buffer.from(fixture.stderr).toString('hex') });
    assert.deepEqual(source.expected, { status: 0, stdoutHex: expectedOutputs[index], stderrHex: '' });
  }
  assert.equal(proof.artifact, '../jq-42-independent-review/legacy-native-proof.json');
  assert.equal(proof.artifactSha256, pins[`${base}jq-42-independent-review/legacy-native-proof.json`]);
  return { id, ...vector, expected: proof.expected, frozenVectorSha256: proof.vectorSha256 };
});

async function snapshot(cwd) {
  const directoryStat = await lstat(cwd);
  assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
  const entries = [];
  for (const name of (await readdir(cwd)).sort()) {
    const path = join(cwd, name);
    const stat = await lstat(path);
    assert.ok(stat.isFile(), `${name}: regular file required`);
    assert.equal(stat.isSymbolicLink(), false);
    const bytes = await readFile(path);
    entries.push({ name, regularFile: true, symbolicLink: false, dev: stat.dev, ino: stat.ino, mode: stat.mode, size: stat.size, bytesHex: bytes.toString('hex'), sha256: digest(bytes) });
  }
  return { directory: { dev: directoryStat.dev, ino: directoryStat.ino, mode: directoryStat.mode }, entries };
}

async function capture(argv, inputHex, expected, withFixture) {
  const cwd = await mkdtemp(join(directory, '.native-'));
  let captureRecord;
  try {
    if (withFixture) await writeFile(join(cwd, 'unicode-start'), Buffer.from('f09f', 'hex'), { flag: 'wx', mode: 0o600 });
    const before = await snapshot(cwd);
    assert.deepEqual(before.entries.map(entry => ({ name: entry.name, bytesHex: entry.bytesHex })), withFixture ? [{ name: 'unicode-start', bytesHex: 'f09f' }] : []);
    const beganAt = new Date().toISOString();
    const result = spawnSync(executable, argv, {
      cwd, env: environment, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      input: Buffer.from(inputHex, 'hex'), timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 65536,
    });
    const endedAt = new Date().toISOString();
    const after = await snapshot(cwd);
    assert.deepEqual(after, before, 'native cwd namespace, file identity and bytes must remain unchanged');
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.ok(result.stdout.length + result.stderr.length <= 65536);
    const actual = { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
    assert.deepEqual(actual, expected);
    captureRecord = { argv, inputHex, cwd, beganAt, endedAt, actual, signal: result.signal, outputBytes: result.stdout.length + result.stderr.length, before, after, namespaceAndBytesPreserved: true, exactFrozenMatch: true, childReaped: true };
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await assert.rejects(lstat(cwd), { code: 'ENOENT' });
    if (captureRecord) captureRecord.cleanup = { removed: true, absenceConfirmed: true, mechanism: 'finally: rm recursive then lstat ENOENT' };
  }
  return captureRecord;
}

const metadata = [
  await capture(['--version'], '', { status: 0, stdoutHex: '6a712d312e372e312d6170706c650a', stderrHex: '' }, false),
  await capture(['--build-configuration'], '', { status: 0, stdoutHex: Buffer.from('--with-oniguruma=builtin\n').toString('hex'), stderrHex: '' }, false),
];
const cases = [];
for (const vector of vectors) {
  const captures = [];
  for (const repeat of [1, 2]) captures.push({ repeat, ...await capture(vector.argv, vector.inputHex, vector.expected, true) });
  assert.deepEqual(captures[0].actual, captures[1].actual);
  cases.push({ ...vector, repeatIdentical: true, captures });
}
for (const [path, expectedHash] of Object.entries(pins)) assert.equal(digest(await readFile(resolve(root, path))), expectedHash, `unchanged: ${path}`);
assert.equal(digest(await readFile(executable)), executableSha256);
assert.equal(digest(await readFile(fileURLToPath(import.meta.url))), harnessSha256);
console.log(JSON.stringify({
  startedAt, endedAt: new Date().toISOString(), harnessSha256,
  sourceFixtures: pins, sourceFixturesUnchanged: true, executable, executableSha256, executableUnchanged: true,
  environment, inheritedEnvironment: false,
  environmentProvenance: 'Exact legacy-native-proof.json environment; original capture-raw-input.mjs inherited an unrecorded environment, which cannot be reconstructed. No claim of reproducing that unrecorded environment.',
  host: { node: process.version, platform: process.platform, arch: arch(), release: release() },
  config: { shell: false, timeoutMs: 2000, killSignal: 'SIGKILL', maxBufferBytes: 65536, assertedCombinedOutputBoundBytes: 65536, stdinEncoding: 'hex', fixtureRoute: 'literal regular file unicode-start; no fd substitution', freshDirectoryPerInvocation: true },
  counts: { cases: 2, repeatsPerCase: 2, captures: 4, exactCapturePasses: 4, metadataInvocations: 2, metadataPasses: 2, totalNativeInvocations: 6, cleanedDirectories: 6 },
  metadata, cases,
  limitations: 'Only two native regular-file cases, repeated twice. No product imports, chunk-partition, VFS, pipeline, full-product, parity or superiority claims. Endpoint namespace/identity/byte checks are not a transient-mutation or ABA guarantee. Historical FD-limited report remains unchanged.',
}, null, 2));
