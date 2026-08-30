import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const root = '/Users/kjopek/Workspace/safe-bash';
const scope = 'tests/commands/filesystem-inspection-stress';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const checked = [];

function check(path, expected, kind = 'file') {
  const absolute = resolve(root, path);
  const stat = lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), kind === 'symlink', path);
  const bytes = kind === 'symlink' ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
  const sha256 = digest(bytes);
  assert.equal(sha256, expected.sha256, path);
  assert.equal(bytes.length, expected.bytes, path);
  checked.push({ path, kind, bytes: bytes.length, sha256 });
}

const tree = json(`${scope}/tree/EVIDENCE-MANIFEST.json`);
for (const entry of tree.entries) check(`${scope}/tree/${entry.path}`, entry, entry.kind);
const catalog = json(`${scope}/file/sealed/catalog.json`);
for (const entry of catalog.artifacts) check(`${scope}/file/sealed/artifacts/${entry.id}`, entry, entry.type);
const fileSummary = json(`${scope}/file/evidence/summary.json`);
assert.equal(fileSummary.initialRun.cases, 40);
assert.equal(fileSummary.initialRun.completedChildren, 40);
assert.deepEqual(fileSummary.rawSemanticCounts, { pass: 35, fail: 3, 'backend-limitation': 2 });
assert.equal(fileSummary.lateRejectionAssertionsExecuted, false);
assert.deepEqual(fileSummary.incompleteHarnessCases, ['F29', 'F33', 'F34']);
assert.deepEqual(fileSummary.content.nativeMachineExact, { matched: 50, total: 60 });
assert.equal(fileSummary.unsupported, 0);
assert.deepEqual(fileSummary.characterizationOnlyBackendCases, ['F30', 'F31']);

const important = [
  'src/contracts/command.md', 'src/contracts/command.ts',
  'src/contracts/filesystem.md', 'src/contracts/filesystem.ts',
  'src/contracts/io.ts', 'src/commands/bytes/README.md',
  'src/commands/file/README.md', 'src/commands/tree/README.md',
  'docs/OUTPUT_LIFECYCLE_REVIEW.md', 'docs/PROJECT_LEDGER.md',
  `${scope}/tree/EVIDENCE-MANIFEST.json`, `${scope}/tree/sealed/run.mjs`,
  `${scope}/file/sealed/catalog.json`, `${scope}/file/evidence/binding.json`,
  `${scope}/file/evidence/summary.json`, `${scope}/file/evidence/freeze.json`,
  `${scope}/file/evidence/initial-run.json`, `${scope}/file/evidence/adjudication.json`,
  ...['F29', 'F33', 'F34'].flatMap((id) => [
    `${scope}/file/evidence/results/${id}.json`,
    `${scope}/file/evidence/results/${id}.events.jsonl`,
  ]),
  '/tmp/safe-bash-tree-holdout-failures.txt', '/tmp/safe-bash-file-holdout-failures.txt',
  '/tmp/safe-bash-file-run.WeB7Vfsc/holdout/isolated-runner.mjs',
];
const corrections = [
  '/tmp/safe-bash-tree-harness-correction-detail.txt',
  '/tmp/safe-bash-file-harness-correction-detail.txt',
].map((path) => ({ path, exists: existsSync(path), sha256: existsSync(path) ? digest(readFileSync(path)) : null }));
const hashes = important.map((path) => ({ path, sha256: digest(readFileSync(resolve(root, path))) }));
console.log(JSON.stringify({
  recordedAt: new Date().toISOString(),
  node: process.version,
  command: 'node tests/commands/filesystem-inspection-stress/harness-review/inspect-evidence.mjs',
  boundary: 'Node builtins only; hashes/assertions over existing evidence, no product imports/calls or native oracle execution',
  treeManifestEntriesVerified: tree.entries.length,
  fileSealedArtifactsVerified: catalog.artifacts.length,
  originalTreeCandidate: tree.candidate,
  originalTreePreseal: tree.originalPresealPayload,
  fileSummary,
  corrections,
  hashes,
  checked,
}, null, 2));
