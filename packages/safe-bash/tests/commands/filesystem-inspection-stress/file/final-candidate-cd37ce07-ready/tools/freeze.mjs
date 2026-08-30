import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const commit = 'cd37ce07c1f41f3797e19e0f701b662823338843';
const snapshot = join(root, 'candidate');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const paths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const entries = git(['ls-tree', '-rz', commit, '--', ...paths]).toString().split('\0').filter(Boolean);
const files = [];
for (const entry of entries) {
  const [metadata, path] = entry.split('\t');
  const [mode, type, blob] = metadata.split(' ');
  assert(type === 'blob' && ['100644', '100755'].includes(mode), `Nonregular candidate entry ${path}`);
  const bytes = git(['cat-file', 'blob', blob]);
  const destination = join(snapshot, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx', mode: mode === '100755' ? 0o500 : 0o400 });
  files.push({ path, blob, mode, bytes: bytes.length, sha256: sha256(bytes) });
}
const lock = JSON.parse(await readFile(join(snapshot, 'package-lock.json')));
const dependencyRoot = await realpath(join(repository, 'node_modules'));
const dependencies = [];
async function copyDependencies(path = '') {
  for (const name of (await readdir(join(dependencyRoot, path))).sort()) {
    const source = join(dependencyRoot, path, name);
    const resolved = await realpath(source);
    assert(resolved === dependencyRoot || resolved.startsWith(`${dependencyRoot}/`), `External dev dependency link ${source}`);
    const metadata = await lstat(resolved);
    const targetPath = join(path, name);
    const destination = join(snapshot, 'node_modules', targetPath);
    if (metadata.isDirectory()) {
      await mkdir(destination, { recursive: true });
      await copyDependencies(targetPath);
    } else {
      assert(metadata.isFile());
      const before = await readFile(resolved);
      await copyFile(resolved, destination);
      const copied = await readFile(destination);
      const after = await readFile(resolved);
      assert.equal(sha256(before), sha256(copied), `Dev copy differs ${targetPath}`);
      assert.equal(sha256(before), sha256(after), `Moving dev input ${targetPath}`);
      await chmod(destination, metadata.mode & 0o111 ? 0o500 : 0o400);
      dependencies.push({ path: `node_modules/${targetPath}`, bytes: copied.length, sha256: sha256(copied) });
    }
  }
}
await mkdir(join(snapshot, 'node_modules'), { recursive: true });
await copyDependencies();
const installed = JSON.parse(await readFile(join(snapshot, 'node_modules/.package-lock.json')));
const packageChecks = [];
for (const [path, entry] of Object.entries(installed.packages)) {
  if (!path) continue;
  assert(lock.packages[path], `Installed package absent from candidate lock: ${path}`);
  assert.equal(entry.version, lock.packages[path].version, path);
  assert.equal(entry.integrity, lock.packages[path].integrity, path);
  const packageJson = JSON.parse(await readFile(join(snapshot, path, 'package.json')));
  assert.equal(packageJson.version, entry.version, path);
  packageChecks.push({ path, version: entry.version, integrity: entry.integrity });
}
const sourceSha256 = sha256(files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''));
const dependencySha256 = sha256(dependencies.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''));
const evidence = { frozenAt: new Date().toISOString(), commit, tree: git(['rev-parse', `${commit}^{tree}`]).toString().trim(), sourceSha256, dependencySha256, files, dependencies, packageChecks, regularFilesOnly: true, liveImportsAllowed: false, lockQualification: 'Installed metadata integrity/version matches candidate lock; individual copied file hashes frozen. No registry tarball download or independent tarball-integrity verification.' };
await writeFile(join(root, 'freeze.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ commit, sourceSha256, dependencySha256, sourceFiles: files.length, dependencyFiles: dependencies.length, lockedPackages: packageChecks.length, snapshot }, null, 2));
