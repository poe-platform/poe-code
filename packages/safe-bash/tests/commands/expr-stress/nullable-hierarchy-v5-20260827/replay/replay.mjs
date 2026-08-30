import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = process.cwd();
assert.equal(repository, '/Users/kjopek/Workspace/safe-bash');
const output = path.dirname(fileURLToPath(import.meta.url));
const base = 'tests/commands/expr-stress/nullable-hierarchy-v5-20260827';
const candidate = '0af75465914815055dd2982f40859ba41dbffcf7';
const seal = 'a995616a48ccc3d712f2fec4f68f7a8b639086f3';
const freeze = 'f561bd9fa33afdf8285154237f856ebfd8495ce4';
const controlsCommit = '18104988c32c467e4025743927c20ee80eaa1781';
const reviewCommit = 'bb283c8c233f164fd4da5f2e21249b007d862a68';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
const json = filename => JSON.parse(readFileSync(filename));
const save = (filename, value) => writeFileSync(path.join(output, filename), typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const inventory = (directory, prefix = '') => readdirSync(directory).sort().flatMap(name => {
  const relative = prefix ? `${prefix}/${name}` : name;
  const filename = path.join(directory, name);
  const stat = lstatSync(filename);
  if (stat.isDirectory()) return [{ path: relative, kind: 'directory' }, ...inventory(filename, relative)];
  assert(stat.isFile() && !stat.isSymbolicLink(), `unexpected entry type: ${relative}`);
  return [{ path: relative, kind: 'file', bytes: stat.size, sha256: hash(readFileSync(filename)) }];
});
const list = (commit, subtree) => git('ls-tree', '-r', '--name-only', commit, '--', subtree).toString().trim().split('\n');
const copyBlob = (commit, filename, target) => {
  const mode = git('ls-tree', commit, '--', filename).toString().slice(0, 6);
  assert(['100644', '100755'].includes(mode));
  const bytes = git('show', `${commit}:${filename}`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  assert.equal(hash(readFileSync(target)), hash(bytes));
  return { path: filename, mode, bytes: bytes.length, sha256: hash(bytes), blob: git('rev-parse', `${commit}:${filename}`).toString().trim() };
};
const run = (label, args, expected) => {
  const started = new Date().toISOString();
  const child = spawnSync(process.execPath, args, { cwd: repository, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  save(`${label}.stdout.data`, child.stdout ?? Buffer.alloc(0));
  save(`${label}.stderr.data`, child.stderr ?? Buffer.alloc(0));
  save(`${label}.execution.json`, { started, ended: new Date().toISOString(), executable: process.execPath, node: process.version, args, cwd: repository, status: child.status, signal: child.signal, error: child.error?.message ?? null, stdoutSha256: hash(child.stdout ?? ''), stderrSha256: hash(child.stderr ?? ''), synchronousChildSettled: true });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  if (expected !== undefined) assert.equal(child.status, expected, label);
  return child;
};
const guards = () => {
  const names = ['src/commands/expr/internal.ts', 'src/commands/expr/bre-worker.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/protocol.ts', 'src/commands/regex-execution/worker.ts'];
  return names.map(filename => {
    const sha256 = hash(readFileSync(filename));
    assert.equal(sha256, hash(git('show', `c3e40f8b:${filename}`)), filename);
    return { path: filename, sha256, matchesInitialC3Guard: true };
  });
};

if (process.argv[2] === 'prepare') {
  assert(!existsSync(path.join(output, 'authentication.json')));
  const scratch = mkdtempSync(path.join(tmpdir(), 'expr-v5-final-replay-'));
  save('scratch.json', { scratch, created: new Date().toISOString() });
  const archive = path.join(scratch, 'candidate');
  const sealed = path.join(scratch, 'sealed');
  const files = [];
  const guardsBefore = guards();
  for (const subtree of ['freeze', 'prototype', 'review']) {
    for (const filename of list(candidate, `${base}/${subtree}`)) files.push(copyBlob(candidate, filename, path.join(archive, filename)));
  }
  for (const [commit, subtree] of [[freeze, 'freeze'], [reviewCommit, 'review']]) {
    assert.deepEqual(list(candidate, `${base}/${subtree}`), list(commit, `${base}/${subtree}`));
    for (const filename of list(commit, `${base}/${subtree}`)) assert.equal(hash(git('show', `${commit}:${filename}`)), hash(readFileSync(path.join(archive, filename))), filename);
  }
  for (const filename of ['CONTROLS.json', 'FREEZE.md']) assert.equal(hash(git('show', `${controlsCommit}:${base}/review/${filename}`)), hash(readFileSync(path.join(archive, base, 'review', filename))));
  for (const [filename, expected] of [
    ['prototype/model.mjs', '9e411191722e796460f347b0848c32da60abaea108bdd78bdf8886ab8c1a8e86'],
    ['prototype/ARTIFACT-MANIFEST.data', '16988780a21753128be37222bace55a205d2e0eeb20d27be96cca6f58c74b2ac'],
    ['review/MANIFEST.json', '10901b9d6fc55eceb81a1445be3ce26d831c59d86e575dc8624d51825ca56f13'],
    ['review/CONTROLS.json', 'af00f1e794152e8f69bfa1641c87cb1e78e9844a768b8220dd79333b45fdf409'],
    ['freeze/MANIFEST.json', 'd2f9faa1269f8b0d86f070ee7a5c3df4a6cc39af3d71c1343ad826d1922eb632'],
  ]) assert.equal(hash(readFileSync(path.join(archive, base, filename))), expected, filename);
  for (const filename of list(seal, `${base}/prototype`)) {
    assert.equal(hash(git('show', `${seal}:${filename}`)), hash(readFileSync(path.join(archive, filename))), filename);
    copyBlob(candidate, filename, path.join(sealed, filename.slice(`${base}/prototype/`.length)));
  }
  const manifest = json(path.join(sealed, 'ARTIFACT-MANIFEST.data'));
  assert.deepEqual(inventory(sealed).filter(entry => entry.path !== 'ARTIFACT-MANIFEST.data'), manifest.entries);
  const review = path.join(archive, base, 'review');
  for (const entry of json(path.join(review, 'MANIFEST.json')).entries) {
    const bytes = readFileSync(path.join(review, entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
  }
  const inherited = readFileSync(path.join(sealed, 'inherited-model.mjs'));
  assert.equal(hash(inherited), hash(git('show', '938fdbc6:tests/commands/expr-stress/nullable-history-order-v4-20260827/design/model.mjs')));
  const receipts = ['/tmp/expr-hierarchy-v5-prototype-candidate.txt', '/tmp/expr-hierarchy-v5-review-candidate.txt'].map(filename => ({ path: filename, text: readFileSync(filename, 'utf8'), sha256: hash(readFileSync(filename)) }));
  save('authentication.json', { candidate, seal, freeze, controlsCommit, reviewCommit, scratch, archive, sealed, review, files, guardsBefore, inheritedSha256: hash(inherited), receipts, archiveBefore: inventory(archive), sealedBefore: inventory(sealed), reportOnlyCandidateAdditions: list(candidate, `${base}/prototype`).filter(filename => !list(seal, `${base}/prototype`).includes(filename)), node: process.version });
  const first = run('controls-01-unbound', [path.join(review, 'run-controls.mjs'), path.join(sealed, 'model.mjs'), path.join(review, 'BINDING.json')], 1);
  const result = JSON.parse(first.stdout);
  const checkpoint = `2026-08-27 independent LEAF replay checkpoint\nCandidate ${candidate}; source seal ${seal}.\nFrozen candidate closure authenticated; no live overlay.\nUnmodified prepared runner actual attempt: ${result.counts.passed}/${result.counts.assertions}, failed ${result.counts.failed}. Candidate build requires explicit eligibility strings; frozen runner supplies legacy booleans/omission.\nBinding-only adapter required; frozen plans/expectations remain unchanged. First stdout/stderr/execution retained in replay/controls-01-unbound.*.\nNext: map true/omitted to LOCAL-TAIL-HYPOTHESIS, false to FINITE-PERMISSIVE in task-owned adapter only; no model change or policy acceptance.\n`;
  writeFileSync('/tmp/expr-v5-final-replay-checkpoint.txt', checkpoint, { flag: 'wx' });
  console.log(checkpoint);
} else if (process.argv[2] === 'author') {
  const auth = json(path.join(output, 'authentication.json'));
  run('author-verifier', [path.join(auth.sealed, 'verify.mjs'), repository], 0);
  const capture = path.join(auth.scratch, 'exclusive-capture.data');
  run('author-capture', [path.join(auth.sealed, 'run-prototype.mjs'), '--capture', capture], 1);
  const bytes = readFileSync(capture);
  assert.equal(hash(bytes), hash(readFileSync(path.join(auth.sealed, 'run-01.data'))));
  save('author-capture.data', bytes);
  const second = run('author-capture-overwrite-negative', [path.join(auth.sealed, 'run-prototype.mjs'), '--capture', capture], 1);
  assert(second.stderr.toString().includes('EEXIST'));
  assert.equal(hash(readFileSync(capture)), hash(bytes));
  save('capture-verification.json', { sha256: hash(bytes), exclusiveCaptureMatched: true, overwriteRefused: true, overwriteChangedBytes: false });
} else if (process.argv[2] === 'capture-check') {
  const auth = json(path.join(output, 'authentication.json'));
  const capture = readFileSync(path.join(auth.scratch, 'exclusive-capture.data'));
  assert.equal(hash(capture), hash(readFileSync(path.join(auth.sealed, 'run-01.data'))));
  assert.equal(hash(capture), hash(readFileSync(path.join(output, 'author-capture.data'))));
  const execution = json(path.join(output, 'author-capture-overwrite-negative.execution.json'));
  assert.equal(execution.status, 1);
  assert.equal(execution.signal, null);
  assert.equal(execution.error, null);
  assert(readFileSync(path.join(output, 'author-capture-overwrite-negative.stderr.data'), 'utf8').includes('EEXIST'));
  save('capture-verification.json', { sha256: hash(capture), exclusiveCaptureMatched: true, overwriteRefused: true, overwriteChangedBytes: false, recovery: 'Authenticated retained child evidence; no capture or author cohort rerun. First driver incorrectly required exit2; actual uncaught EEXIST exits1.' });
} else if (process.argv[2] === 'matrices') {
  const auth = json(path.join(output, 'authentication.json'));
  const before = inventory(auth.scratch);
  save('scratch-before-final-checks.json', before);
  run('prepared-matrices', [path.join(output, 'replay-matrices.mjs'), path.join(output, 'authentication.json')], 0);
  const after = inventory(auth.scratch);
  assert.deepEqual(after, before);
  save('scratch-after-final-checks.json', after);
} else if (process.argv[2] === 'finalize') {
  const auth = json(path.join(output, 'authentication.json'));
  const archiveAfter = inventory(auth.archive);
  const sealedAfter = inventory(auth.sealed);
  assert.deepEqual(archiveAfter, auth.archiveBefore);
  assert.deepEqual(sealedAfter, auth.sealedBefore);
  const guardsAfter = guards();
  assert.deepEqual(guardsAfter, auth.guardsBefore);
  save('final-integrity.json', { archiveAfter, sealedAfter, guardsAfter, completeBeforeAfterInventoryEqual: true, addedEntriesAndTypesDetected: true, allOwnedChildrenSynchronousAndReaped: true, sourceCleanWithinFiveGuards: true, noProductExecution: true });
  assert(path.basename(auth.scratch).startsWith('expr-v5-final-replay-'));
  assert.equal(path.dirname(auth.scratch), tmpdir());
  rmSync(auth.scratch, { recursive: true });
  assert(!existsSync(auth.scratch));
  save('cleanup.json', { scratch: auth.scratch, removed: true, allOwnedChildrenClosed: true, date: new Date().toISOString() });
  console.log('Authenticated inventories/guards unchanged; all owned children settled; unique scratch removed.');
} else {
  throw new Error('usage: node replay.mjs prepare|author|capture-check|matrices|finalize');
}
