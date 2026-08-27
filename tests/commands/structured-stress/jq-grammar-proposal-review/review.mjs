import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const owned = 'tests/commands/structured-stress/jq-grammar-proposal-review';
const base = 'tests/commands/structured-stress';
const author = `${base}/jq-grammar-author-20260827`;
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => {
  const path = `${owned}/${name}`;
  assert.ok(!existsSync(resolve(root, path)), `Refusing overwrite: ${path}`);
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
const walk = directory => readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const proposal = json(`${author}/planned-test-only-changes-v2.json`);
const rows = [...proposal.proposal, ...proposal.supplemental];
const snapshots = json(`${author}/canonical-before.json`);
const inventory = json(`${base}/jq-grammar-independent/canonical-red-inventory.json`);

if (process.argv[2] === 'freeze') {
  const paths = new Set([
    'AGENTS.md', ...walk('src/contracts'),
    ...snapshots.snapshots.map(snapshot => snapshot.path),
    ...walk(`${base}/jq-grammar-independent`),
    ...walk(`${base}/jq-42-independent-final`),
    ...walk(`${base}/jq-42-independent-review`),
    `${base}/jq-42-author-20260827/final-owned.tap`,
    `${base}/raw-input-native.json`,
    `${base}/raw-input-harness.ts`,
    `${base}/harness.ts`,
    ...readdirSync(resolve(root, author)).filter(name => /^(native-.*\.json|baseline-.*\.json|canonical-before\.json|planned-test-only-changes.*\.json|PROPOSAL\.md|propose\.mjs)$/.test(name)).map(name => `${author}/${name}`),
  ].filter(path => existsSync(resolve(root, path))));
  const files = Object.fromEntries([...paths].sort().map(path => [path, sha256(read(path))]));
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
  save('inputs-before.json', { recordedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']), preparationCommit: git(['rev-parse', 'd5b8fff']), files });
  console.log(`Frozen ${paths.size} read-only inputs; 26 proposal rows.`);
} else if (process.argv[2] === 'check') {
  const before = json(`${owned}/inputs-before.json`);
  const checks = Object.entries(before.files).map(([path, expected]) => ({ path, expected, actual: sha256(read(path)) }));
  assert.deepEqual(checks.filter(check => check.expected !== check.actual), [], 'Read-only review input changed');
  for (const snapshot of snapshots.snapshots) {
    assert.equal(sha256(snapshot.text), snapshot.sha256);
    assert.equal(sha256(read(snapshot.path)), snapshot.sha256);
    const committed = spawnSync('git', ['show', `${snapshots.head}:${snapshot.path}`], { cwd: root });
    assert.equal(committed.status, 0, committed.stderr.toString());
    assert.equal(sha256(committed.stdout), snapshot.sha256, `Snapshot commit: ${snapshot.path}`);
  }
  const manifest = json(`${base}/jq-grammar-independent/manifest.json`);
  for (const [path, expected] of Object.entries({ ...manifest.historicalFiles, ...manifest.ownedFiles })) assert.equal(sha256(read(path)), expected, path);
  assert.equal(rows.length, 26);
  assert.deepEqual(proposal.proposal.map(row => row.oldTestName).sort(), inventory.entries.map(entry => entry.name).sort());
  for (const row of rows) {
    assert.ok(read(row.oldTestPath).toString().includes(row.oldAssertion), `Assertion block changed: ${row.oldTestName}`);
    for (const proof of Array.isArray(row.nativeProof) ? row.nativeProof : [row.nativeProof]) {
      const artifact = relative(root, resolve(root, author, proof.artifact));
      assert.equal(sha256(read(artifact)), proof.artifactSha256, artifact);
      const data = json(artifact);
      const vector = (data.probes ?? data.vectors).find(vector => vector.id === proof.id);
      assert.ok(vector, proof.id);
      assert.equal(sha256(JSON.stringify(vector)), proof.vectorSha256, proof.id);
      for (const key of ['argv', 'inputHex', 'expected']) assert.deepEqual(proof[key], vector[key], `${proof.id}: ${key}`);
    }
  }
  console.log(`Verified ${checks.length} stable inputs, ${Object.keys(manifest.historicalFiles).length} historical manifest entries, five exact snapshots, all 26 original blocks and native proof hashes.`);
  if (process.argv[3]) save(process.argv[3], { recordedAt: new Date().toISOString(), result: 'stable', historicalManifestEntries: Object.keys(manifest.historicalFiles).length, preparationManifestEntries: Object.keys(manifest.ownedFiles).length, checks });
} else {
  throw new Error('Expected freeze or check');
}
