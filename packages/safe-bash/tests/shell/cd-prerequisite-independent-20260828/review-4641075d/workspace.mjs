import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { blob, git, gitHash, inventory, pins, repo, sha256 } from './common.mjs';

const roots = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md'];
const providerPaths = ['src/fs/webdav/webdav.ts', 'src/fs/webdav/README.md'];
const providerHashes = ['cf65b82429bd92ca52b73490e1d6c1070545b5912fbddaba7037e01c57cc21f5', 'b931ac0545c709d3be2bd7d8e328fe9b1137cdb6514dfd8e9975c64c1fecb7bd'];

export function rewriteTree(tree, changes, prefix = '') {
  const entries = git(['ls-tree', '-z', tree]).toString().split('\0').filter(Boolean);
  const bytes = entries.map(entry => {
    const [header, name] = entry.split('\t');
    let [mode, kind, hash] = header.split(' ');
    const path = prefix + name;
    if (changes[path]) { assert.equal(kind, 'blob'); hash = changes[path]; }
    else if (kind === 'tree' && Object.keys(changes).some(key => key.startsWith(`${path}/`))) hash = rewriteTree(hash, changes, `${path}/`);
    return Buffer.concat([Buffer.from(`${mode === '040000' ? '40000' : mode} ${name}\0`), Buffer.from(hash, 'hex')]);
  });
  return gitHash('tree', Buffer.concat(bytes));
}

export function compose(binding) {
  const baselineTree = git(['rev-parse', `${pins.baseline}^{tree}`]).toString().trim();
  const changes = {};
  for (const [index, path] of providerPaths.entries()) {
    const bytes = blob(pins.provider, path);
    assert.equal(sha256(bytes), providerHashes[index]);
    changes[path] = gitHash('blob', bytes);
  }
  assert.equal(rewriteTree(baselineTree, changes), pins.composition);
  changes[binding.runtime.path] = binding.runtime.blob;
  assert.equal(rewriteTree(baselineTree, changes), binding.candidateComposedTree);
  const entries = git(['ls-tree', '-r', '-z', pins.baseline, '--', ...roots]).toString().split('\0').filter(Boolean);
  assert.equal(entries.length, 265);
  return Object.fromEntries(entries.map(entry => {
    const [header, path] = entry.split('\t');
    const [mode, kind, originalBlob] = header.split(' ');
    assert.equal(kind, 'blob');
    assert(['100644', '100755'].includes(mode));
    const commit = path === binding.runtime.path ? binding.candidateCommit : providerPaths.includes(path) ? pins.provider : pins.baseline;
    const bytes = blob(commit, path);
    assert.equal(gitHash('blob', bytes), changes[path] ?? originalBlob);
    return [path, { mode: parseInt(mode.slice(-3), 8), sha256: sha256(bytes), blob: gitHash('blob', bytes), commit, bytes }];
  }));
}

export function materializeSource(files, target) {
  assert(!existsSync(target));
  for (const [path, entry] of Object.entries(files)) {
    const destination = resolve(target, path);
    assert(destination.startsWith(`${target}/`));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, entry.bytes, { flag: 'wx', mode: entry.mode });
  }
  const manifest = JSON.parse(readFileSync(resolve(target, 'package.json')));
  assert.equal(manifest.name, 'virtual-bash');
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  return inventory(target);
}

export function copyRegular(source, target) {
  const stat = lstatSync(source);
  assert(!stat.isSymbolicLink(), `regular tools/consumers only: ${source}`);
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: stat.mode & 0o777 });
    for (const name of readdirSync(source).sort()) copyRegular(resolve(source, name), resolve(target, name));
  } else {
    assert(stat.isFile());
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target, 1);
    chmodSync(target, stat.mode & 0o777);
  }
}

export function tools(route, target) {
  const bytes = readFileSync(resolve(repo, route.tools.manifestPath));
  assert.equal(sha256(bytes), route.tools.manifestSha256);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema, 1);
  assert.deepEqual(Object.keys(manifest.roots).sort(), ['node', 'nodeTypes', 'npm', 'typescript', 'undiciTypes']);
  const paths = {};
  for (const [role, entry] of Object.entries(manifest.roots)) {
    assert.equal(resolve(entry.source), entry.source);
    assert(!target.startsWith(`${entry.source}/`), 'tool copy destination cannot be inside its source');
    assert.deepEqual(inventory(entry.source), entry.inventory);
    const destination = resolve(target, role);
    copyRegular(entry.source, destination);
    assert.deepEqual(inventory(destination), entry.inventory);
    assert.deepEqual(inventory(entry.source), entry.inventory);
    paths[role] = destination;
    if (entry.entrypoint) {
      const file = resolve(destination, entry.entrypoint);
      assert(file.startsWith(`${destination}/`) && lstatSync(file).isFile());
      paths[`${role}Entry`] = file;
    }
  }
  for (const role of ['node', 'typescript', 'npm']) assert(paths[`${role}Entry`], `${role} entrypoint required`);
  return { paths, inventory: inventory(target), sourceManifest: manifest };
}

export function assertSource(files, target) {
  for (const [path, entry] of Object.entries(files)) {
    const destination = resolve(target, path);
    assert(lstatSync(destination).isFile() && !lstatSync(destination).isSymbolicLink());
    assert.equal(sha256(readFileSync(destination)), entry.sha256, path);
  }
  const actual = Object.keys(inventory(target)).filter(path => path && !path.startsWith('dist/') && path !== 'dist' && !path.startsWith('node_modules/') && path !== 'node_modules');
  const expected = new Set();
  for (const path of Object.keys(files)) {
    expected.add(path);
    let parent = dirname(path);
    while (parent !== '.') { expected.add(parent); parent = dirname(parent); }
  }
  assert.deepEqual(actual.sort(), [...expected].sort(), 'source additions outside exact build/tool directories');
}
