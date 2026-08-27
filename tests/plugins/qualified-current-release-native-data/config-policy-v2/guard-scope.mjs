import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFreshCommittedArchive } from '../../../integration/full-gate-20260827/combined-8670ebe8/committed-archive.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const runner = 'tests/integration/full-gate-20260827/combined-8670ebe8/run.mjs';
const revision = '6699804ace9f5522aa67be6a017a8008bfc09f30';
const bytes = execFileSync('git', ['show', `${revision}:${runner}`], { cwd: repository });
const original = bytes.toString();
const functionText = original.slice(original.indexOf('function verifySource() {'), original.indexOf('\nfunction copyDependencies('));
assert.ok(functionText.startsWith('function verifySource() {'));
const hash = value => createHash('sha256').update(value).digest('hex');
const temporary = mkdtempSync(join(tmpdir(), 'safe-bash-integrity-scope-'));
const output = resolve(process.argv[2]);
assert.equal(existsSync(output), false);
const report = { revision, runnerSha256: hash(bytes), functionSha256: hash(functionText), controls: [] };
const observe = (name, action) => { action(); report.controls.push(name); };
try {
  const source = join(temporary, 'source');
  mkdirSync(join(source, 'src'), { recursive: true });
  mkdirSync(join(source, 'evidence'));
  const originals = { 'src/current.ts': Buffer.from('export const current = 1;\n'), 'evidence/original.json': Buffer.from('{}\n') };
  const sourceHashes = {}, entries = [];
  for (const [path, content] of Object.entries(originals)) {
    writeFileSync(join(source, path), content);
    chmodSync(join(source, path), 0o644);
    sourceHashes[path] = { sha256: hash(content), mode: 0o644, symlink: false };
    entries.push({ path, mode: '100644', bytes: content.length, blob: createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex') });
  }
  const verifySource = new Function('source', 'sourceHashes', 'lstatSync', 'hash', 'readlinkSync', 'readFileSync', 'join', `${functionText}; return verifySource;`)(source, sourceHashes, lstatSync, hash, readlinkSync, readFileSync, join);
  observe('fresh exact archive and tracked post-check accept original bytes', () => { verifyFreshCommittedArchive(source, entries); assert.deepEqual(verifySource(), []); });
  for (const path of ['src/unexpected.ts', 'evidence/unexpected.json']) {
    writeFileSync(join(source, path), 'extra');
    observe(`post-check does not detect new ${path}`, () => assert.deepEqual(verifySource(), []));
    observe(`fresh admission rejects new ${path}`, () => assert.throws(() => verifyFreshCommittedArchive(source, entries), /missing or extra input/u));
    rmSync(join(source, path));
  }
  mkdirSync(join(source, 'unexpected-directory'));
  observe('post-check does not detect a new empty directory', () => assert.deepEqual(verifySource(), []));
  observe('fresh admission rejects a new empty directory', () => assert.throws(() => verifyFreshCommittedArchive(source, entries), /extra directory/u));
  rmSync(join(source, 'unexpected-directory'), { recursive: true });
  writeFileSync(join(source, 'src/current.ts'), 'changed');
  observe('tracked byte mutation is detected', () => assert.deepEqual(verifySource(), ['src/current.ts']));
  writeFileSync(join(source, 'src/current.ts'), originals['src/current.ts']);
  chmodSync(join(source, 'src/current.ts'), 0o600);
  observe('tracked mode mutation is detected', () => assert.deepEqual(verifySource(), ['src/current.ts']));
  chmodSync(join(source, 'src/current.ts'), 0o644);
  rmSync(join(source, 'evidence/original.json'));
  observe('tracked deletion is detected', () => assert.deepEqual(verifySource(), ['evidence/original.json']));
  report.scope = 'Fresh admission compares exact files/directories. Post-phase verifySource only enumerates original tracked paths; new source/artifact entries are not detected. No guard change or universal integrity claim.';
} finally {
  rmSync(temporary, { recursive: true, force: true });
  report.temporaryRemoved = !existsSync(temporary);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ controls: report.controls.length, temporaryRemoved: report.temporaryRemoved, output }));
