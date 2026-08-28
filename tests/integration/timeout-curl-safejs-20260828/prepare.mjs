import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { own, repo, node, git, candidate, engineCommit, packHash, sha, hashFile, read, save, gitRead, privateState, authenticate } from './common.mjs';

const references = [
  ['tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/author/surface/PINS.json', 'b8f437199991fd6afda5ba63da4cde9b29d9b3217164e3bbd90969b3c8da7992'],
  ['tests/integration/safejs-owned-output-prototype-review/provenance/snapshot-after.json', 'f2aa8a751b4410e58af95735ee0a1ac901ce2f124e1e15b5ceefd5cf067f0bdd'],
  ['tests/integration/timeout-public-author-20260828/evidence/PACKAGE-FILES.json', '0174f8e3c54901af482aa9e87adee4065ac971489a9cdf6875e755b19c5172ec'],
  ['tests/integration/du-public-independent-evidence-20260827/admission-v2/closure.json', 'b4263e32e6b2ea91a7f8eccceb1133a04ef09d614adca2c8021737572dbd0ad7'],
  ...[
    'tests/commands/timeout-independent-20260828/public-integration-freeze-v1/BINDINGS.json',
    'tests/commands/timeout-independent-20260828/public-candidate-execution-v1/AUTHOR-BINDINGS.json',
    'tests/commands/timeout-independent-20260828/public-b01-capture-v1/HANDOFF.md',
    'tests/commands/timeout-independent-20260828/public-b01-capture-v1/REVIEW.json',
    'tests/commands/timeout-independent-20260828/clock.mjs',
    'tests/commands/timeout-independent-20260828/repaired-f22-v1/recipe/io.mjs',
    'tests/integration/owned-output-production-independent-20260827/candidate-v1/safejs-loader.mjs',
    'tests/integration/owned-output-production-independent-20260827/candidate-v1/safejs-review.mjs',
    'tests/integration/owned-output-production-independent-20260827/candidate-v1/REPORT.md',
  ].map(path => [path, hashFile(join(repo, path))]),
].map(([path, sha256]) => ({ path, sha256 }));
references.forEach(row => authenticate(row));
assert.equal(sha(gitRead(repo, ['show', `2736db840369a51dd76e7f5cc115bd44fe8e0f54:${references[2].path}`])), references[2].sha256);
const pins = read(join(repo, references[0].path)), snapshot = read(join(repo, references[1].path));
assert.equal(sha(gitRead(repo, ['show', `${pins.provenance.commit}:tests/integration/safejs-owned-output-prototype-review/provenance/snapshot-after.json`])), references[1].sha256);
const tools = read(join(repo, references[3].path));
tools.binaries.forEach(row => authenticate({ ...row, absolute: true }));
assert.equal(process.execPath, node); assert.equal(process.version, 'v22.22.2');
const before = privateState(); assert.equal(before.head, engineCommit);
const engine = Object.entries(snapshot.private.engine).map(([path, row]) => ({ path, mode: row.mode, bytes: row.bytes, sha256: row.sha256 }));
assert.equal(engine.length, 264);
assert.deepEqual(before.engine.filter(row => row.kind === 'file').map(({ path, mode, bytes, sha256 }) => ({ path, mode, bytes, sha256 })), engine);
const packageBinding = read(join(repo, references[2].path));
assert.equal(packageBinding.candidate, candidate); assert.equal(packageBinding.pack.sha256, packHash);
authenticate({ ...packageBinding.pack, path: packageBinding.pack.physical, absolute: true });
const initial = read(join(repo, references[4].path));
const supplemental = read(join(repo, references[5].path));
const selected = [...initial.selectedInputs, ...supplemental.additionalBuildInputs];
const source = selected.map(({ path }) => {
  const entry = gitRead(repo, ['ls-tree', candidate, '--', path]).toString().trim().split(/\s+/u);
  assert.equal(entry[1], 'blob'); assert.ok(['100644', '100755'].includes(entry[0]));
  const bytes = gitRead(repo, ['cat-file', 'blob', entry[2]]);
  return { path, blob: entry[2], mode: parseInt(entry[0], 8) & 511, bytes: bytes.length, sha256: sha(bytes) };
});
assert.equal(source.length, 269);
const typescript = tools.packages.find(row => row.name === 'typescript');
for (const row of typescript.records.filter(row => row.type === 'file')) authenticate({ ...row, path: join(typescript.root, row.path), absolute: true });
save(join(own, 'BINDINGS.json'), {
  schema: 'timeout-curl-actual-safejs-workflow-v1', preparedAt: new Date().toISOString(), candidate,
  tree: gitRead(repo, ['rev-parse', `${candidate}^{tree}`]).toString().trim(), source,
  package: packageBinding, engineCommit, engine, engineClosure: pins.privateEngine.staticImportClosure,
  tools: tools.binaries, typescript, references, privateBeforePreparation: before,
  stagingReuse: '264-file snapshot and 63-file actual-import closure from qualified regular-copy staging; only copied engine TS gets explicit .js-to-.ts resolution. Product never has source fallback.',
  privateGuardScope: 'Engine inventory detects new regular entries/mode/hash/mtime/ctime changes; Git head/status/staged/index plus four root metadata files. AGENTS read only for applicable instructions, never copied or included as proof. atime intentionally not compared; excluded build/cache directories retain old profile.',
  chronology: 'Post-candidate and after explicit source/API inspection. New workflow expectations, not a pre-source freeze. No new product execution at preparation.',
  oldQualification: 'Public78 dd5b40c4 bound, not replayed. SafeJS prior S1, dialect/rejection observations and zero-retry qualifications retained. No original25 rescore; no exact guest-realm object-identity claim.',
});
console.log(JSON.stringify({ prepared: true, source: source.length, engine: engine.length, engineClosure: pins.privateEngine.staticImportClosure.length, pack: packHash, node, git, productExecutions: 0 }));
