import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const accepted = '3eba797a2f286c80149dff22afbcd177e3ffea08';
const acceptedDirectory = 'tests/shell-stress/first-read-contract-review';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const blob = (path) => git('show', `${accepted}:${path}`);
const sealPath = resolve(owned, 'intentions-freeze.json');
const sources = [
  'REPORT.md',
  'CONTROLS.md',
  'primary-sources.md',
  'evidence/source-copy.json',
  'evidence/inputs.json',
  'preserved/src/contracts/command.md.data',
  'preserved/src/contracts/command.ts.data',
  'preserved/src/contracts/io.ts.data',
  'preserved/src/shell/types.ts.data',
];
const originalInputs = [
  'tests/shell/first-read-probe.ts',
  'tests/shell/remote-close.test.ts',
  'tests/stress/remote-cancellation/helpers.ts',
  'tests/shell/helpers.ts',
];

function describe(path, bytes) {
  return { path, bytes: bytes.length, sha256: hash(bytes) };
}

function verify() {
  const seal = JSON.parse(readFileSync(sealPath, 'utf8'));
  assert.equal(seal.acceptedReview, accepted);
  for (const entry of seal.intentions) {
    assert.deepEqual(describe(entry.path, readFileSync(resolve(owned, entry.path))), entry);
  }
  for (const entry of [...seal.acceptedSources, ...seal.originalInputs]) {
    assert.deepEqual(describe(entry.path, blob(entry.path)), entry);
  }
  const cases = JSON.parse(readFileSync(resolve(owned, 'holdouts.json'), 'utf8'));
  assert.equal(cases.logicalCaseCount, 16);
  assert.equal(cases.cases.length, 16);
  assert.equal(new Set(cases.cases.map((entry) => entry.id)).size, 16);
  assert.equal(cases.cases.filter((entry) => entry.family === 'original-adapted').length, 5);
  assert.equal(cases.cases.filter((entry) => entry.family === 'new').length, 11);
  assert.equal(cases.innerDeadlineMs, 1200);
  assert.equal(Buffer.byteLength(cases.frozenConstants.curlBodyUtf8), 18);
  return { sealSha256: hash(readFileSync(sealPath)), logicalCases: 16, productExecuted: false };
}

assert.equal(git('rev-parse', '--show-toplevel').toString().trim(), root);
if (process.argv[2] === 'seal') {
  assert.equal(existsSync(sealPath), false, 'Refusing to overwrite independent freeze');
  const sourceCopy = JSON.parse(blob(`${acceptedDirectory}/evidence/source-copy.json`));
  assert.equal(sourceCopy.sourceFileCount, 212);
  assert.equal(sourceCopy.sourceManifestSha256, '6d8589043618e623e35a63e92cbecc160b7f587335a69bba3e0b0f57e34dca8b');
  const seal = {
    schema: 1,
    frozenAt: new Date().toISOString(),
    classification: 'independent-pre-API-pre-implementation-intentions-only',
    authorImplementationInspected: false,
    authorTestBodiesInspected: false,
    authorApiDeclarationInspected: false,
    otherReviewerHoldoutBodiesInspected: false,
    productExecuted: false,
    acceptedReview: accepted,
    acceptedSourceHead: 'c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79',
    acceptedSourceManifestSha256: sourceCopy.sourceManifestSha256,
    acceptedSourceCount: sourceCopy.sourceFileCount,
    intentions: ['INTENT.md', 'holdouts.json'].map((path) => describe(path, readFileSync(resolve(owned, path)))),
    acceptedSources: sources.map((path) => {
      const fullPath = `${acceptedDirectory}/${path}`;
      return describe(fullPath, blob(fullPath));
    }),
    originalInputs: originalInputs.map((path) => {
      const archived = `${acceptedDirectory}/preserved/${path}.data`;
      return describe(archived, blob(archived));
    }),
    checkoutHeadNotCandidate: git('rev-parse', 'HEAD').toString().trim(),
    initialIndexPathEntries: git('ls-files', '--stage').toString().split('\n').filter(Boolean),
    worktreePathStatus: git('status', '--short', '--untracked-files=normal').toString(),
    stagedNames: git('diff', '--cached', '--name-only').toString(),
    nodeVersion: process.version,
    nodeExecutable: describe(process.execPath, readFileSync(process.execPath)),
    authorReadyPresentAtFreeze: existsSync('/tmp/safe-bash-owned-output-prototype.ready'),
    authority: 'User assignment and coordination; no production permission. Original artifacts retained in accepted commit, never reclassified as adapted successes.',
  };
  writeFileSync(sealPath, `${JSON.stringify(seal, null, 2)}\n`, { flag: 'wx' });
} else {
  assert.equal(process.argv[2], 'verify', 'Use seal once or verify; neither executes product');
}
console.log(JSON.stringify(verify(), null, 2));
