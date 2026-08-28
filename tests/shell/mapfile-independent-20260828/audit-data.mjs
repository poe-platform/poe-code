import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const revision = '1fe588eeba0cdb09adfb948eeded681d15d134f2';
const directory = 'tests/shell/mapfile-design-20260828';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
const blob = (commit, name) => git('show', `${commit}:${name}`);
const packet = name => blob(revision, `${directory}/${name}`);
const checks = [];
const check = (id, operation) => { operation(); checks.push(id); };
const seal = JSON.parse(packet('SEAL.json'));
const bindings = JSON.parse(packet('SOURCE-BINDINGS.json'));
const observations = JSON.parse(packet('OBSERVATIONS.json'));
const protectedFiles = Object.keys(seal.artifactHashes).concat('SEAL.json');
const initial = new Map(protectedFiles.map(name => [name, hash(readFileSync(`${root}/${directory}/${name}`))]));
const metadata = [];

for (const name of protectedFiles) {
  check(`packet:${name}`, () => {
    const bytes = packet(name);
    assert.equal(initial.get(name), hash(bytes));
    if (name !== 'SEAL.json') assert.equal(hash(bytes), seal.artifactHashes[name]);
    metadata.push({ path: `${directory}/${name}`, revision, bytes: bytes.length, sha256: hash(bytes) });
  });
}
const entries = git('ls-tree', '-r', '--name-only', revision, '--', directory).toString().trim().split('\n');
check('six-data-documents-no-executable-observer', () => assert.deepEqual(entries.map(name => name.slice(directory.length + 1)).sort(), protectedFiles.slice().sort()));
for (const item of [...bindings.sources, ...bindings.references]) {
  check(`bound-source:${item.path}`, () => {
    const bytes = blob(item.revision, item.path);
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256);
    if (item.blob) assert.equal(git('rev-parse', `${item.revision}:${item.path}`).toString().trim(), item.blob);
    metadata.push({ path: item.path, revision: item.revision, bytes: bytes.length, sha256: hash(bytes) });
  });
}
let totalScriptBytes = 0;
let totalStdinBytes = 0;
for (const [index, row] of observations.rows.entries()) {
  check(`neutral-row:${row.id}`, () => {
    assert.equal(row.id, `N${String(index + 1).padStart(2, '0')}`);
    assert.equal(row.expectation, null);
    assert.equal(row.classification, 'neutral-not-executed');
    assert.match(row.stdinHex, /^(?:[0-9a-f]{2})*$/);
    const script = Buffer.from(row.script);
    const stdin = Buffer.from(row.stdinHex, 'hex');
    assert.equal(script.length, row.scriptBytes);
    assert.equal(stdin.length, row.stdinBytes);
    assert.equal(hash(script), row.scriptSha256);
    assert.equal(hash(stdin), row.stdinSha256);
    assert.ok(script.length <= 4096 && stdin.length <= 4096);
    totalScriptBytes += script.length;
    totalStdinBytes += stdin.length;
  });
}
check('totals-and-neutrality', () => {
  assert.deepEqual({ rows: observations.rows.length, scriptBytes: totalScriptBytes, stdinBytes: totalStdinBytes }, { rows: 32, scriptBytes: 3264, stdinBytes: 217 });
  assert.deepEqual(observations.actualDataTotals, { rows: 32, scriptBytes: 3264, stdinBytes: 217 });
  for (const key of ['nativeExecutions', 'productExecutions', 'modelExecutions', 'scoredPasses']) assert.equal(observations[key], 0);
  assert.equal(observations.expectedOutputsProvided, false);
});
check('N30-does-not-hit-UTF8-first-delimiter-byte', () => {
  const row = observations.rows.find(row => row.id === 'N30');
  assert.ok(row.script.includes("-d 'é'"));
  assert.equal(Buffer.from('é')[0], 0xc3);
  assert.equal(Buffer.from(row.stdinHex, 'hex').includes(0xc3), false);
});
const additionalPrimary = {
  path: '/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/general.c',
  bytes: 36727, mode: 0o644,
  sha256: '669ef408f4bcc6b4ce424677d29532f28e903430c93b335fa1a292dd360bd165',
  archiveMember: 'bash-5.3/general.c',
};
const primaryMembers = [...bindings.native.sourceMembers, additionalPrimary];
const native = [bindings.native.binary, bindings.native.archive, ...primaryMembers];
const nativeBefore = native.map(item => {
  const info = lstatSync(item.path);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(realpathSync(item.path), item.path);
  assert.equal(info.size, item.bytes);
  assert.ok(info.size <= 16 * 1024 * 1024);
  const digest = hash(readFileSync(item.path));
  check(`local-primary:${item.path.split('/').at(-1)}`, () => {
    assert.equal(digest, item.sha256);
    if (item.mode !== undefined) assert.equal(info.mode & 0o777, item.mode);
  });
  return { path: item.path, sha256: digest, bytes: info.size, mode: info.mode & 0o777, dev: info.dev, ino: info.ino };
});
const archive = gunzipSync(readFileSync(bindings.native.archive.path), { maxOutputLength: 64 * 1024 * 1024 });
const selected = new Map(primaryMembers.map(item => [item.archiveMember, item]));
const found = new Map();
for (let offset = 0; offset + 512 <= archive.length;) {
  const header = archive.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '');
  const size = Number.parseInt(text(124, 136).trim(), 8);
  assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= archive.length);
  const checksum = [...header].reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
  assert.equal(checksum, Number.parseInt(text(148, 156).trim(), 8));
  const name = [text(345, 500), text(0, 100)].filter(Boolean).join('/');
  if (selected.has(name)) {
    assert.ok(header[156] === 0 || header[156] === 48);
    assert.ok(!found.has(name));
    found.set(name, hash(archive.subarray(offset + 512, offset + 512 + size)));
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
for (const [name, item] of selected) check(`archive-member:${name}`, () => assert.equal(found.get(name), item.sha256));
const versionRow = bindings.native.priorVersion;
const versionBytes = readFileSync(`${root}/${versionRow.path}`);
check('prior-LET-version-artifact', () => {
  assert.equal(hash(versionBytes), versionRow.artifactSha256);
  const rows = versionBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  const row = rows.find(item => item.id === versionRow.id);
  assert.ok(row);
  assert.equal(row.stdout, versionRow.stdout);
});
for (const item of nativeBefore) check(`post-local:${item.path.split('/').at(-1)}`, () => {
  const info = lstatSync(item.path);
  assert.ok(info.isFile());
  assert.equal(info.dev, item.dev);
  assert.equal(info.ino, item.ino);
  assert.equal(info.mode & 0o777, item.mode);
  assert.equal(hash(readFileSync(item.path)), item.sha256);
});
check('post-design-no-drift', () => {
  for (const [name, digest] of initial) assert.equal(hash(readFileSync(`${root}/${directory}/${name}`)), digest);
});
console.log(JSON.stringify({
  schema: 'mapfile-independent-static-data-v1', reviewedRevision: revision,
  scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) },
  classification: 'metadata/data checks only; no parser, shell, observer, product, native or candidate execution',
  successfulChecks: checks.length, checks, metadata, nativeBefore,
  rows: 32, scriptBytes: totalScriptBytes, stdinBytes: totalStdinBytes,
  executableObserverFiles: 0, nativeCalls: 0, productCalls: 0, arrayCandidateCalls: 0,
  inheritedVersion: versionRow.stdout, archiveInflatedBytes: archive.length,
  observationsReadyForExecution: false, reason: 'observer implementation and separately qualified controls/root GO absent',
}, null, 2));
