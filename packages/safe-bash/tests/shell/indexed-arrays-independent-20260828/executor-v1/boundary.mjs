import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { gunzipSync } from 'node:zlib';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function regular(path) {
  assert.equal(resolve(path), path, 'absolute normalized path');
  assert.equal(realpathSync(path), path, 'no symbolic path escape');
  assert.ok(lstatSync(path).isFile(), 'regular file');
  return readFileSync(path);
}
export function census(root) {
  assert.ok(isAbsolute(root)); assert.equal(realpathSync(root), root);
  const entries = {}; let files = 0; let total = 0;
  const visit = (directory, depth) => {
    assert.ok(depth <= 32, 'bounded tree depth');
    const names = readdirSync(directory).sort(); assert.ok(names.length <= 10000);
    for (const name of names) {
      assert.notEqual(name, 'AGENTS.md');
      const path = join(directory, name); const stat = lstatSync(path);
      assert.ok(!stat.isSymbolicLink(), 'no linked member');
      if (stat.isDirectory()) { entries[relative(root, path) + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(path, depth + 1); }
      else {
        assert.ok(stat.isFile()); assert.ok(++files <= 10000); total += stat.size; assert.ok(total <= 128 * 1024 * 1024);
        entries[relative(root, path)] = { mode: stat.mode & 0o777, bytes: stat.size, sha256: digest(readFileSync(path)) };
      }
    }
  };
  visit(root, 0); return entries;
}
export function verifyTree(tree) { assert.deepEqual(census(tree.root), tree.entries, 'append-aware exact tree census'); }
export function authenticate(path, expected) {
  assert.match(expected, /^[a-f0-9]{64}$/u);
  const bytes = regular(path); assert.equal(digest(bytes), expected); return bytes;
}
export function tarInventory(compressed) {
  assert.ok(compressed.length <= 16 * 1024 * 1024);
  const data = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  const members = {}; let offset = 0;
  const text = bytes => bytes.toString().split('\0')[0];
  const octal = bytes => { const value = text(bytes).trim(); assert.match(value, /^[0-7]+$/u); return parseInt(value, 8); };
  while (offset + 512 <= data.length && data[offset] !== 0) {
    const header = data.subarray(offset, offset + 512);
    const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(checksum, octal(header.subarray(148, 156)));
    assert.ok(header[156] === 0 || header[156] === 48, 'regular tar files only');
    assert.equal(text(header.subarray(157, 257)), ''); assert.equal(text(header.subarray(345, 500)), '');
    const path = text(header.subarray(0, 100)); assert.ok(path.startsWith('package/'));
    const name = path.slice(8); assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    assert.ok(!Object.hasOwn(members, name)); assert.ok(Object.keys(members).length < 10000);
    const bytes = octal(header.subarray(124, 136)); assert.ok(offset + 512 + bytes <= data.length);
    members[name] = { mode: octal(header.subarray(100, 108)), bytes, sha256: digest(data.subarray(offset + 512, offset + 512 + bytes)) };
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  assert.ok(data.length - offset >= 1024 && data.subarray(offset).every(value => value === 0));
  return members;
}
export function admit(path, expected, goPath, goDigest) {
  const manifest = JSON.parse(authenticate(path, expected));
  assert.equal(manifest.kind, 'array-candidate-review-v1', 'synthetic cannot be a product manifest');
  const go = JSON.parse(authenticate(goPath, goDigest));
  assert.equal(go.action, 'execute-array-candidate');
  assert.match(go.rootReceipt, /^[a-f0-9]{40}$/u);
  assert.equal(go.candidate, manifest.candidate); assert.match(manifest.candidate, /^[a-f0-9]{40}$/u);
  assert.equal(go.manifestSha256, expected);
  assert.equal(manifest.baseTree, '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e');
  assert.equal(realpathSync(process.execPath), manifest.node.path);
  assert.equal(process.version, manifest.node.version); authenticate(manifest.node.path, manifest.node.sha256);
  assert.ok(Array.isArray(manifest.trees) && manifest.trees.length >= 2 && manifest.trees.length <= 8);
  const allowed = new Map();
  for (const tree of manifest.trees) {
    verifyTree(tree);
    for (const [name, entry] of Object.entries(tree.entries)) {
      if (entry.directory) continue;
      const filename = join(tree.root, name); assert.ok(!allowed.has(filename)); allowed.set(filename, entry.sha256);
    }
  }
  for (const entry of manifest.requiredFiles) assert.ok(allowed.has(entry), 'bound required source/declaration/harness member');
  for (const key of ['rootModule', 'runtimeModule', 'rootDeclaration', 'workerModule', 'vectorsFile', 'holdoutsFile', 'controlsFile', 'baselineFile', 'packageTar']) assert.ok(allowed.has(manifest[key]), key);
  authenticate(manifest.vectorsFile, '7d9c591a044fa1fc609c1c6e72a06146ec9e0c26d7c45304d516418f425e5095');
  authenticate(manifest.controlsFile, '8c9c0604e4f855fd5bd9fdf7b5d4f09cee11b2b1a631bf99bc26217777d16951');
  authenticate(manifest.holdoutsFile, 'b38508ef94dcd8ce42329c7cf1e173ab460a200e3ddb96e4f5e4cfdd8b3e5e95');
  const baseline = JSON.parse(authenticate(manifest.baselineFile, 'c154ccc9f221080d3b19f0a3dc3eff38529ef9e16c464317fa3635f8789ad21d'));
  const projection = verifyProjection(baseline.source, manifest.sourceProjection);
  assert.deepEqual(projection.unapprovedChanges, [], 'source write set');
  assert.equal(projection.projectionSha256, manifest.sourceProjectionSha256);
  const sourceTree = manifest.trees.find(tree => tree.root === manifest.sourceRoot);
  assert.ok(sourceTree, 'entire selected source census');
  assert.deepEqual(Object.keys(sourceTree.entries).filter(name => !sourceTree.entries[name].directory).sort(), manifest.sourceProjection.map(entry => entry.path).sort());
  for (const entry of manifest.sourceProjection) {
    const sourcePath = join(manifest.sourceRoot, entry.path);
    authenticate(sourcePath, entry.sha256);
    assert.equal(lstatSync(sourcePath).mode & 0o777, parseInt(entry.mode, 8) & 0o777);
  }
  assert.ok(manifest.trees.some(tree => tree.root === manifest.packageRoot));
  assert.ok(manifest.trees.some(tree => tree.root === manifest.harnessRoot));
  assert.equal(authenticate(join(manifest.harnessRoot, 'package.json'), allowed.get(join(manifest.harnessRoot, 'package.json'))).toString(), '{"private":true,"type":"module"}\n', 'isolated consumer package boundary');
  assert.equal(manifest.rootModule, join(manifest.packageRoot, 'dist/index.js'));
  assert.equal(manifest.runtimeModule, join(manifest.packageRoot, 'dist/shell/runtime.js'));
  const metadata = JSON.parse(authenticate(join(manifest.packageRoot, 'package.json'), allowed.get(join(manifest.packageRoot, 'package.json'))));
  assert.equal(metadata.name, 'virtual-bash'); assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  authenticate(join(manifest.packageRoot, 'package.json'), manifest.sourceProjection.find(entry => entry.path === 'package.json').sha256);
  const archived = tarInventory(authenticate(manifest.packageTar, manifest.packageSha256));
  const packageTree = manifest.trees.find(tree => tree.root === manifest.packageRoot);
  assert.deepEqual(Object.fromEntries(Object.entries(packageTree.entries).filter(([, entry]) => !entry.directory)), archived, 'entire package equals authenticated tar');
  assert.ok(['source-build', 'installed', 'moved'].includes(manifest.layout));
  assert.match(manifest.packageSha256, /^[a-f0-9]{64}$/u);
  assert.match(manifest.sourceProjectionSha256, /^[a-f0-9]{64}$/u);
  assert.equal(manifest.defaultCount, 77);
  assert.equal(manifest.astTypes.accepted, true, 'bound prior actual AST/type phase required');
  assert.equal(manifest.astTypes.candidate, manifest.candidate);
  assert.match(manifest.astTypes.receiptSha256, /^[a-f0-9]{64}$/u);
  const typeReceipt = JSON.parse(authenticate(manifest.astTypes.receiptPath, manifest.astTypes.receiptSha256));
  assert.equal(typeReceipt.candidate, manifest.candidate); assert.equal(typeReceipt.packageSha256, manifest.packageSha256);
  assert.equal(typeReceipt.accepted, true); assert.deepEqual(typeReceipt.unapprovedAstChanges, []);
  assert.equal(typeReceipt.sourceProjectionSha256, manifest.sourceProjectionSha256);
  return { manifest, allowed };
}
export function guard(bound, emit) {
  const loaded = new Map();
  registerHooks({ load(url, context, nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url, context);
    assert.ok(url.startsWith('file:'), 'only bound regular-file loads');
    const filename = fileURLToPath(url); const expected = bound.allowed.get(filename);
    assert.ok([bound.manifest.packageRoot, bound.manifest.harnessRoot].some(root => filename.startsWith(root + '/')), 'no source-tree module fallback');
    assert.ok(expected, `unbound module ${filename}`); authenticate(filename, expected);
    const result = nextLoad(url, context);
    assert.ok(result.source !== null && result.source !== undefined, 'actual loaded source required');
    assert.equal(digest(Buffer.from(result.source)), expected, 'executing module bytes');
    if (!loaded.has(filename)) { loaded.set(filename, expected); emit({ load: { path: filename, sha256: expected } }); }
    return result;
  } });
  return loaded;
}
export function verifyProjection(base, candidate, authorizations = []) {
  const prior = new Map(base.map(entry => [entry.path, entry]));
  const seen = new Set(); const unapprovedChanges = [];
  for (const entry of candidate) {
    assert.ok(!seen.has(entry.path)); seen.add(entry.path);
    assert.ok(entry.path.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    assert.match(entry.commit, /^[a-f0-9]{40}$/u); assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
    const old = prior.get(entry.path);
    assert.equal(entry.mode, old?.mode ?? '100644', 'no source mode drift');
    if (old?.sha256 === entry.sha256 && old.mode === entry.mode) continue;
    const ordinary = old ? ['src/shell/runtime.ts', 'src/shell/parser.ts', 'src/shell/shell.ts'].includes(entry.path) : /^src\/shell\/arrays\/[a-zA-Z0-9_/-]+\.ts$/u.test(entry.path);
    if (!ordinary && !authorizations.includes(entry.path)) unapprovedChanges.push(entry.path);
  }
  for (const name of prior.keys()) if (!seen.has(name)) unapprovedChanges.push(`removed:${name}`);
  return { unapprovedChanges, projectionSha256: digest(Buffer.from(JSON.stringify(candidate))) };
}
export const moduleURL = path => pathToFileURL(path).href;
