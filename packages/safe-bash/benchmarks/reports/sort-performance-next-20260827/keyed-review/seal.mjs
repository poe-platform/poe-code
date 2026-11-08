import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authenticate, directory, hash, inventory, json, repo } from './harness.mjs';

const prepared = ['baseline-attempt1', 'candidate-preparation'].map(label => JSON.parse(readFileSync(join(directory, label, 'prepared.json'))));
const tools = join(directory, 'used-tools'); mkdirSync(tools);
const proofs = [];
const children = [];
for (const preparation of prepared) {
  const finalIntegrity = authenticate(preparation);
  const workspaces = [];
  for (const entry of readdirSync(preparation.root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(preparation.root, entry.name);
    const manifestPath = join(root, 'module-manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath));
    for (const file of manifest) assert.equal(hash(readFileSync(join(root, file.path))), file.sha256, file.path);
    const actualPackage = inventory(join(root, 'node_modules/virtual-bash'));
    assert.deepEqual(actualPackage, manifest.filter(file => file.path.startsWith('node_modules/virtual-bash/')).map(file => ({ path: file.path.slice('node_modules/virtual-bash/'.length), sha256: file.sha256 })));
    const differences = actualPackage.filter(file => file.sha256 !== preparation.packageBefore.find(before => before.path === file.path)?.sha256);
    assert.ok(differences.length <= 1 && differences.every(file => file.path === 'dist/commands/text.js'));
    const assets = [];
    for (const file of manifest.filter(file => !file.path.startsWith('node_modules/'))) {
      const bytes = readFileSync(join(root, file.path));
      const saved = file.path.endsWith('.mjs') ? `used-tools/${file.sha256}.mjs.txt` : undefined;
      if (saved && !existsSync(join(directory, saved))) writeFileSync(join(directory, saved), bytes, { flag: 'wx' });
      assets.push({ ...file, ...(saved ? { saved } : {}) });
    }
    workspaces.push({ name: entry.name, manifestSha256: hash(readFileSync(manifestPath)), packageFiles: actualPackage.length, packageDelta: differences, assets, allFilesAndNamesVerified: true, unexpectedSymlinksRejected: true });
  }
  proofs.push({ commit: preparation.commit, root: preparation.root, ...finalIntegrity, workspaces });
}
for (const entry of readdirSync(directory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  for (const name of readdirSync(join(directory, entry.name))) {
    if (!name.endsWith('.child.json')) continue;
    const child = JSON.parse(readFileSync(join(directory, entry.name, name)));
    assert.equal(child.exactChildClosed, true);
    assert.equal(child.killed, null);
    children.push({ evidence: entry.name + '/' + name, ...child });
  }
}
copyFileSync('/tmp/sort-key-review-findings.txt', join(directory, 'findings.txt'));
copyFileSync('/tmp/sort-key-review-coordination.txt', join(directory, 'final-coordination.txt'));
json(join(directory, 'final-integrity.json'), { proofs, compilerVersion: JSON.parse(readFileSync(join(repo, 'node_modules/typescript/package.json'))).version, allOwnedTestChildrenClosed: children.length, children, inventoryQualification: 'Full final file-name/hash comparison detects added regular files and rejects unexpected symlinks. Earlier inventory helper ignored symlinks; this final stronger check covers still-present snapshots. Intentional build node_modules toolchain link is the only permitted exception.' });
const cleanup = [];
for (const preparation of prepared) {
  assert.equal(realpathSync(preparation.root), preparation.root);
  assert.match(preparation.root, /^\/private\/tmp\/sort-key-review-(baseline|candidate)-[A-Za-z0-9]+$/u);
  rmSync(preparation.root, { recursive: true });
  assert.equal(existsSync(preparation.root), false);
  cleanup.push({ root: preparation.root, removed: true });
}
json(join(directory, 'cleanup.json'), { roots: cleanup, childHandlesClosed: children.length, globalKillUsed: false, nativeOracleRuns: 0, markerRetention: 'Root coordination, frozen-ready, findings and final-ready handoff files intentionally remain; no product or foreign paths removed.' });
console.log(JSON.stringify({ cleanup, childrenClosed: children.length, toolSnapshots: readdirSync(tools).length }));
