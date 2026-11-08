import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, '../../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(root, 'PRESEAL.json'));
const seal = JSON.parse(sealBytes);
const expectations = JSON.parse(fs.readFileSync(path.join(root, 'EXPECTATIONS.json')));
const output = path.join(root, 'runs', 'RESULTS.json');
assert.equal(process.env.NODE_OPTIONS ?? '', '');
assert.deepEqual(process.execArgv, ['--unhandled-rejections=strict']);
assert.equal(process.argv.length, 3);
assert.match(process.argv[2], /^[0-9a-f]{40}$/);
assert.equal(fs.existsSync(output), false);
assert.equal(expectations.length, 8);
assert.deepEqual(expectations.map(entry => entry.id), ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08']);

function snapshot(entries) {
  return entries.map(entry => {
    const filename = path.join(repository, entry.path);
    const info = fs.lstatSync(filename);
    assert.equal(info.isFile() && !info.isSymbolicLink(), true);
    return { path: entry.path, bytes: info.size, mode: info.mode & 0o7777, sha256: digest(fs.readFileSync(filename)) };
  });
}

function errorRecord(error) {
  return { name: error?.name ?? null, code: error?.code ?? null, message: error?.message ?? null, stack: error?.stack ?? null };
}

const startedAt = new Date().toISOString();
const sourcesBefore = snapshot(seal.sources);
const inputsBefore = snapshot(seal.inputs);
assert.deepEqual(sourcesBefore, seal.sources);
assert.deepEqual(inputsBefore, seal.inputs);
for (const reference of seal.nonexistentReferences) assert.equal(fs.existsSync(path.join(repository, reference)), false);
for (const entry of expectations) {
  const filename = path.join(root, entry.fixture);
  const info = fs.lstatSync(filename);
  assert.equal(info.mode & 0o7777, 0o644);
  assert.ok(info.size > 0 && info.size <= 2048);
  assert.equal(digest(fs.readFileSync(filename)), entry.sha256);
}

const rows = [];
let fatal = null;
try {
  const { readAuthorization } = await import(pathToFileURL(path.join(repository, seal.authorizationPath)).href);
  for (const entry of expectations) {
    let returned;
    let rejected = null;
    try {
      returned = readAuthorization(path.join(root, entry.fixture), entry.sha256, root);
    } catch (error) {
      rejected = errorRecord(error);
    }
    const outcome = rejected ? 'rejected' : 'accepted';
    const expected = entry.expected;
    const matches = outcome === expected.outcome && (!rejected || rejected.code === expected.code);
    const parsed = JSON.parse(fs.readFileSync(path.join(root, entry.fixture)));
    let unchanged = null;
    if (!rejected) {
      try { assert.deepEqual(returned, parsed); unchanged = true; }
      catch { unchanged = false; }
    }
    rows.push({
      id: entry.id, fixture: entry.fixture, sha256: entry.sha256, expected, outcome,
      matches: matches && unchanged !== false,
      returned: rejected ? null : returned,
      returnedReviewCommitType: rejected ? null : typeof returned.review.commit,
      returnedReviewCommitIsArray: rejected ? null : Array.isArray(returned.review.commit),
      returnedUnchanged: unchanged, error: rejected,
    });
  }
} catch (error) {
  fatal = errorRecord(error);
}

let sourcesAfter = null;
let inputsAfter = null;
let integrityError = null;
try {
  sourcesAfter = snapshot(seal.sources);
  inputsAfter = snapshot(seal.inputs);
  assert.deepEqual(sourcesAfter, sourcesBefore);
  assert.deepEqual(inputsAfter, inputsBefore);
  for (const reference of seal.nonexistentReferences) assert.equal(fs.existsSync(path.join(repository, reference)), false);
} catch (error) {
  integrityError = errorRecord(error);
}
const evidence = {
  classification: 'BOUNDED_SCHEMA_DATA_REVIEW_NOT_AUTHORIZATION',
  candidate: seal.candidate, suppliedEvidenceCommit: seal.suppliedEvidenceCommit,
  suppliedRecipeSha256: seal.suppliedRecipeSha256, presealCommit: process.argv[2],
  presealSha256: digest(sealBytes), startedAt, finishedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, execArgv: process.execArgv },
  entrypoint: 'readAuthorization only', expectedCases: 8, actualCalls: rows.length,
  matchingExpectations: rows.filter(entry => entry.matches).length,
  divergentExpectations: rows.filter(entry => !entry.matches).map(entry => entry.id),
  rows, fatal, integrityError, sourcesBefore, sourcesAfter, inputsBefore, inputsAfter,
  integrityScope: 'Listed files only; not append-proof or concurrent-mutation protection.',
};
fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
console.log(JSON.stringify({ actualCalls: rows.length, matchingExpectations: evidence.matchingExpectations, divergentExpectations: evidence.divergentExpectations, fatal, integrityError }));
process.exitCode = fatal || integrityError || rows.length !== 8 ? 2 : evidence.divergentExpectations.length ? 1 : 0;
