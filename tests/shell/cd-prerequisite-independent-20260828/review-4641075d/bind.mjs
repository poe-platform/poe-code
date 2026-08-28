import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(directory, '../../../..');
export const own = 'tests/shell/cd-prerequisite-independent-20260828/review-4641075d';
export const control = 'tests/shell/cd-prerequisite-independent-20260828';
export const pins = { candidate: '4641075df5355a91c83bf5b2cc3a88dfaf1f5153', evidence: '8c0c17f0f5e7670d06cd7e9a0a8da3995e970375', baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290', provider: 'ca1d33424b94a21ae0f40a36412fd8191611e2df', composition: '7c68831a81fc49c94ad9177e58ca9fd7d0aca352', preparation: 'a9cae01073dc5c73f806b5ba38fdfa56fb502d0c', freeze: 'beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e', ratification: '2fbd1e051993cadf384cf4fc559f20e3f0b7cc1c' };
export const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
export const blob = (commit, path) => git(['show', `${commit}:${path}`]);
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export const save = (name, value) => writeFileSync(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
export const identify = (commit, path) => { const bytes = blob(commit, path); return { commit, path, blob: objectHash('blob', bytes), sha256: sha(bytes), bytes: bytes.length }; };
export const treePaths = (commit, path) => git(['ls-tree', '-r', '--name-only', commit, '--', path]).toString().trim().split('\n').filter(Boolean);
export const inventory = (root, exclude = new Set()) => {
  const entries = {};
  const visit = (path, name) => { if (exclude.has(name)) return; const stat = lstatSync(path); assert(!stat.isSymbolicLink(), path); if (stat.isDirectory()) { entries[name] = { kind: 'directory', mode: stat.mode & 511 }; for (const child of readdirSync(path).sort()) visit(resolve(path, child), name ? `${name}/${child}` : child); } else { assert(stat.isFile()); const bytes = readFileSync(path); entries[name] = { kind: 'file', mode: stat.mode & 511, bytes: bytes.length, sha256: sha(bytes) }; } }; visit(root, ''); return entries;
};
export const foreignStaging = () => { const parts = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']).toString().split('\0'); const entries = []; for (let index = 0; index + 1 < parts.length; index += 2) if (!parts[index + 1].startsWith(`${own}/`)) entries.push(`${parts[index]}\t${parts[index + 1]}`); return entries.sort(); };
export function controls() {
  const old = JSON.parse(readFileSync(resolve(directory, '../executor-preparation-v1/INPUTS.json')));
  assert.deepEqual(inventory(resolve(repo, control), new Set(['executor-preparation-v1', 'review-4641075d'])), old.inheritedInventory);
  const preparation = JSON.parse(readFileSync(resolve(directory, '../executor-preparation-v1/MANIFEST.json')));
  assert.deepEqual(inventory(resolve(directory, '../executor-preparation-v1'), new Set(['MANIFEST.json'])), preparation.entries);
  const files = treePaths(pins.preparation, control);
  assert.equal(files.length, 41);
  for (const path of files) assert.deepEqual(readFileSync(resolve(repo, path)), blob(pins.preparation, path), path);
  assert.deepEqual(inventory(resolve(repo, old.providerRoot)), old.providerInventoryBefore);
  for (const entry of old.protectedFiles) assert.equal(sha(readFileSync(resolve(repo, entry.path))), entry.sha256, entry.path);
  const author = treePaths(pins.evidence, 'tests/shell/cd-prerequisite-20260828/runtime-v1').map(path => identify(pins.evidence, path));
  for (const entry of author) assert.equal(sha(readFileSync(resolve(repo, entry.path))), entry.sha256);
  return { files: files.map(path => identify(pins.preparation, path)), priorHistorical: old.protectedFiles, author, providerInventory: old.providerInventoryBefore, foreignStaging: foreignStaging() };
}
export function composeTrees() {
  const proof = {};
  const rewrite = (tree, changes, prefix = '') => {
    const original = git(['cat-file', 'tree', tree]); proof[tree] = original.toString('base64');
    const entries = git(['ls-tree', '-z', tree]).toString().split('\0').filter(Boolean);
    const bytes = Buffer.concat(entries.map(entry => { const [header, name] = entry.split('\t'); let [mode, kind, hash] = header.split(' '); const path = prefix + name; if (changes[path]) { assert.equal(kind, 'blob'); hash = changes[path]; } else if (kind === 'tree' && Object.keys(changes).some(key => key.startsWith(`${path}/`))) hash = rewrite(hash, changes, `${path}/`); return Buffer.concat([Buffer.from(`${mode === '040000' ? '40000' : mode} ${name}\0`), Buffer.from(hash, 'hex')]); }));
    const hash = objectHash('tree', bytes); proof[hash] = bytes.toString('base64'); return hash;
  };
  const baselineTree = git(['rev-parse', `${pins.baseline}^{tree}`]).toString().trim();
  const changes = {};
  for (const path of ['src/fs/webdav/webdav.ts', 'src/fs/webdav/README.md']) changes[path] = identify(pins.provider, path).blob;
  assert.equal(rewrite(baselineTree, changes), pins.composition);
  changes['src/shell/runtime.ts'] = identify(pins.candidate, 'src/shell/runtime.ts').blob;
  return { baselineTree, baseComposition: pins.composition, candidateComposedTree: rewrite(baselineTree, changes), changes, proof };
}
if (process.argv[2] === '--preseal') {
  const preserved = controls();
  const trees = composeTrees();
  const runtime = identify(pins.candidate, 'src/shell/runtime.ts');
  assert.equal(runtime.blob, 'd32239c31e5b4cdf11fd7863a407283119a209ec');
  assert.equal(runtime.sha256, '93c06908aec9d5d61d801657f99ab75122cadb6688f038e1941c587b4a8d4ed3');
  const evidence = identify(pins.evidence, 'tests/shell/cd-prerequisite-20260828/runtime-v1/HANDOFF.md');
  const commits = [...new Set(Object.entries(pins).filter(([key]) => key !== 'composition').map(([, value]) => value))].map(commit => { const bytes = git(['cat-file', 'commit', commit]); assert.equal(objectHash('commit', bytes), commit); return { commit, sha256: sha(bytes), raw: bytes.toString() }; });
  save('BINDING.json', { state: 'routed-candidate', candidateCommit: pins.candidate, candidateComposedTree: trees.candidateComposedTree, runtime, evidence, baseline: pins.baseline, provider: pins.provider, composition: pins.composition });
  save('CONTROL-IDENTITY.json', preserved);
  save('TREE-PROOF.json', { ...trees, commits });
  save('PRESEAL.json', { stage: 'candidate binding before runtime-body inspection or product execution', capturedAt: new Date().toISOString(), authorization: 'ROOT user message explicitly routes actual different review of4641075d/evidence8c0c17f;86 rows/types10+10 across3 layouts; bounded controls; no source edits/native/services', handoffExposure: 'Committed HANDOFF.md read first. It contains source-change descriptions/hashes and author-result history; no runtime implementation body inspected. Runtime bytes hashed only to authenticate binding.', preparation: pins.preparation, inherited: { original: 18, ratification: 4, executor: 19 }, productionExecution: 0, setupObservation: 'Initial read-only zsh loop used reserved path variable, hiding PATH; retried with filepath. No files changed or product work ran.', ownFilesBeforeSeal: inventory(directory), foreignStaging: foreignStaging() });
  console.log(JSON.stringify({ runtime, evidence, candidateComposedTree: trees.candidateComposedTree, controls: preserved.files.length }));
}
