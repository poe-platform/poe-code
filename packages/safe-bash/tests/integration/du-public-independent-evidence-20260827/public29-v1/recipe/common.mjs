import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const recipe = dirname(fileURLToPath(import.meta.url));
export const scope = resolve(recipe, '..');
export const repository = resolve(scope, '../../../..');
export const history = resolve(scope, '..');
export const frozen = join(repository, 'tests/integration/du-public-independent-20260827');
export const candidate = '0895de2dc63014989f23912c3d48f7c4d0d35a47';
export const freeze = '1bd1048b0075adf9ee1ebf041e299122f72c3459';
export const packSha = '4d4d071a0142ac950240f7c3aaacd5283777143d70cc2e3c245ba199fdd01c7d';
export const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const gitBinary = '/usr/bin/git';
export const work = join(scope, 'node_modules', 'du-public-work');
export const raw = join(scope, 'raw');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const read = target => JSON.parse(fs.readFileSync(target, 'utf8'));
export const fileHash = target => sha(fs.readFileSync(target));
export const errorRecord = error => ({ name: error.name, code: error.code, message: error.message, stack: error.stack });
export function write(target, bytes) {
  fs.mkdirSync(dirname(target), { recursive: true });
  const descriptor = fs.openSync(target, 'wx');
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
export const save = (target, value) => write(target, `${JSON.stringify(value, null, 2)}\n`);
export let gitCalls = 0;
export function git(...args) {
  const result = execFileSync(gitBinary, ['--no-replace-objects', '--no-optional-locks', '-C', repository, ...args], { timeout: 15000, maxBuffer: 32 * 1024 ** 2, env: { PATH: '/usr/bin:/bin', HOME: scope, TMPDIR: scope, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
  gitCalls++;
  return result;
}
export function safe(path) {
  assert.equal(typeof path, 'string');
  assert.ok(path && !path.startsWith('/') && !/[\\\0]/u.test(path));
  assert.ok(!path.split('/').some(part => ['', '.', '..', 'AGENTS.md'].includes(part)), path);
  return path;
}
export function tree(root, aliases = false) {
  const records = [];
  function visit(relative) {
    for (const name of fs.readdirSync(join(root, relative)).sort()) {
      assert.notEqual(name, 'AGENTS.md');
      const path = relative ? `${relative}/${name}` : name;
      const target = join(root, path), stat = fs.lstatSync(target);
      const record = { path, mode: stat.mode & 0o777 };
      if (stat.isSymbolicLink()) {
        assert.equal(aliases, true, `SYMLINK:${target}`);
        records.push({ ...record, type: 'symlink', link: fs.readlinkSync(target), realpath: fs.realpathSync(target) });
      } else if (stat.isDirectory()) { records.push({ ...record, type: 'directory' }); visit(path); }
      else { assert.ok(stat.isFile(), target); records.push({ ...record, type: 'file', bytes: stat.size, sha256: fileHash(target) }); }
    }
  }
  visit('');
  return records;
}
export function fileMap(root) { return Object.fromEntries(tree(root).filter(row => row.type === 'file').map(row => [row.path, row.sha256])); }
export function treeGuard(actual, expected) { assert.deepEqual(actual, expected, 'FRESH_TREE_INTEGRITY'); }
export function bindReference(commit, path, expected) {
  safe(path);
  const bytes = git('show', `${commit}:${path}`);
  const sha256 = sha(bytes);
  if (expected) assert.equal(sha256, expected, path);
  const stat = fs.lstatSync(join(repository, path));
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(fileHash(join(repository, path)), sha256, path);
  return { commit, path, sha256, bytes: bytes.length };
}
export function protectedGuard(bindings) {
  for (const row of bindings.protectedFiles) {
    const target = join(repository, row.path), stat = fs.lstatSync(target);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), row.path);
    assert.equal(fileHash(target), row.sha256, row.path);
  }
  for (const [root, expected] of Object.entries(bindings.closedInventories)) assert.deepEqual(fileMap(join(repository, root)), expected, root);
}
export function authenticateTools(bindings) {
  for (const binary of bindings.binaries) {
    assert.equal(fs.realpathSync(binary.path), binary.realpath);
    assert.equal(fileHash(binary.path), binary.sha256);
  }
  let regular = 0, aliases = 0;
  for (const dependency of bindings.closure.packages) {
    const expected = dependency.records.map(({ targetSha256, ...entry }) => entry);
    const actual = tree(dependency.root, true);
    assert.equal(new Set(expected.map(row => row.path)).size, expected.length);
    assert.deepEqual(Object.fromEntries(actual.map(row => [row.path, row])), Object.fromEntries(expected.map(row => [row.path, row])), dependency.name);
    for (const entry of dependency.records) {
      if (entry.type === 'file') regular++;
      if (entry.type === 'symlink') {
        aliases++;
        const target = dependency.records.find(row => row.type === 'file' && join(dependency.root, row.path) === entry.realpath);
        assert.ok(target, 'ALIAS_TARGET_NOT_REGULAR_BOUND_INPUT');
        assert.equal(target.sha256, entry.targetSha256);
      }
    }
  }
  assert.equal(regular, 2274); assert.equal(aliases, 12);
  return { regular, metadataOnlyAliases: aliases };
}
export function authenticateSelected(bindings, contents) {
  const rows = git('ls-tree', '-rz', candidate, '--', ...bindings.selectors).toString().split('\0').filter(Boolean).map(line => {
    const [metadata, path] = line.split('\t'), [mode, type, gitBlob] = metadata.split(' ');
    safe(path); assert.equal(type, 'blob'); assert.ok(['100644', '100755'].includes(mode));
    return { mode, type, path, gitBlob };
  });
  const expected = bindings.sourceInventory.map(({ sha256, ...row }) => row);
  assert.equal(new Set(expected.map(row => row.path)).size, expected.length);
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.path, row])), Object.fromEntries(expected.map(row => [row.path, row])));
  assert.equal(rows.length, 771);
  if (contents) for (const entry of bindings.sourceInventory) {
    const bytes = git('cat-file', 'blob', entry.gitBlob);
    assert.equal(blob(bytes), entry.gitBlob); assert.equal(sha(bytes), entry.sha256, entry.path);
    contents(entry, bytes);
  }
  return { files: rows.length, candidate, tree: git('rev-parse', `${candidate}^{tree}`).toString().trim() };
}
export function authenticateRecipe(commit) {
  const manifest = read(join(recipe, 'MANIFEST.json'));
  const expected = { ...fileMap(recipe) }; delete expected['MANIFEST.json'];
  assert.deepEqual(expected, manifest.files);
  const prefix = 'tests/integration/du-public-independent-evidence-20260827/public29-v1/recipe';
  assert.equal(sha(git('show', `${commit}:${prefix}/MANIFEST.json`)), fileHash(join(recipe, 'MANIFEST.json')));
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(sha(git('show', `${commit}:${prefix}/${name}`)), digest, name);
  return { commit, manifestSha256: fileHash(join(recipe, 'MANIFEST.json')) };
}
export function packageGuard(root, expected) {
  assert.deepEqual(fileMap(root), expected, 'FULL_INSTALLED_PACKAGE');
  const metadata = read(join(root, 'package.json'));
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.equal(metadata.name, 'virtual-bash');
  for (const [key, leaf] of [['.', 'index'], ['./commands/du', 'commands/du/index']]) {
    const entry = metadata.exports[key];
    assert.equal(entry.types, `./dist/${leaf}.d.ts`);
    assert.equal(entry.import ?? entry.default, `./dist/${leaf}.js`);
  }
  return metadata;
}
export function loadGuard(records, configuration) {
  const loads = records.filter(row => row.event === 'module-load');
  for (const specifier of ['virtual-bash', 'virtual-bash/commands/du']) {
    const resolution = records.find(row => row.event === 'public-resolution' && row.specifier === specifier);
    assert.ok(resolution, `MISSING_RESOLUTION:${specifier}`);
    assert.equal(resolution.key, configuration.publicTargets[specifier]);
    assert.equal(resolution.url, new URL(resolution.key, new URL(`file://${configuration.consumerRoot}/`)).href);
    assert.ok(loads.some(row => row.key === resolution.key), `MISSING_ACTUAL_LOAD:${specifier}`);
  }
  assert.ok(loads.length > 0);
  for (const entry of loads) {
    assert.ok(Object.hasOwn(configuration.expectedLoads, entry.key), `UNEXPECTED_LOAD:${entry.key}`);
    assert.equal(entry.sha256, configuration.expectedLoads[entry.key], `LOAD_HASH:${entry.key}`);
    assert.equal(fileURLToPath(entry.url), join(configuration.consumerRoot, entry.key), 'LOAD_URL');
    assert.ok(!entry.key.includes('/shell/cancellation.'), 'PRIVATE_HELPER_LOAD');
  }
  return { loads: loads.length, unique: new Set(loads.map(row => row.key)).size };
}
