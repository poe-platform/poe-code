import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { root, owned, work, ready, files, hashes, drift, json, sha, save } from './tools.mjs';

assert.ok(existsSync(ready), 'Root READY required before any final source freeze');
assert.ok(existsSync('/tmp/safe-bash-comm-fix-result.txt'), 'Closed source-author handoff required');
const snapshot = join(work, 'snapshot');
assert.ok(!existsSync(snapshot), 'One final snapshot only; root must authorize any re-freeze');
const prior = json(join(root, 'tests/commands/diff-patch-stress/routed-five-review/table-inputs.json'));
const inputs = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
for (const path of files(root, 'src')) inputs.add(path);
for (const row of prior.records) inputs.add(row.path);
for (const directory of ['tests/commands/table-text', 'tests/commands/metadata', owned, 'tests/commands/table-text-stress/shared-stdin-fix']) {
  for (const path of files(root, directory)) if (!path.split('/').some(part => part.startsWith('.'))) inputs.add(path);
}
for (const path of files(root, 'tests/commands/table-text-stress')) {
  if (dirname(path) === 'tests/commands/table-text-stress' && /\.(ts|json)$/.test(path)) inputs.add(path);
}
const nativeRoot = 'tests/commands/metadata-stress/.oracle/coreutils-9.7';
for (const suffix of ['.tar.xz', '/doc/coreutils.texi', '/src/comm', '/src/comm.c', '/src/paste', '/src/paste.c', '/src/join', '/src/join.c', '/src/stat', '/src/stat.c', '/src/touch']) inputs.add(nativeRoot + suffix);
const queued = [...inputs];
for (let index = 0; index < queued.length; index++) {
  const path = queued[index];
  if (!/\.(ts|mjs)$/.test(path)) continue;
  for (const match of readFileSync(join(root, path), 'utf8').matchAll(/["'](\.[^"'\n]+\.(?:js|ts|mjs|json))["']/g)) {
    let target = relative(root, resolve(root, dirname(path), match[1]));
    if (target.endsWith('.js') && !existsSync(join(root, target))) target = target.slice(0, -3) + '.ts';
    if (target.startsWith('../') || !existsSync(join(root, target)) || !statSync(join(root, target)).isFile() || inputs.has(target)) continue;
    inputs.add(target);
    queued.push(target);
  }
}
const dependencies = files(root, 'node_modules');
for (const path of dependencies) inputs.add(path);
const before = hashes(root, inputs);
const authorManifest = json(join(root, 'tests/commands/table-text-stress/shared-stdin-fix/handoff-manifest.json'));
for (const [path, digest] of Object.entries(authorManifest.sourceMap)) assert.equal(before[path], digest, path);
assert.equal(before['tests/commands/table-text/cases.ts'], '17118aa95f15c8cd1d47d6aebf624b7013df965e87c39fb81bfebfa63b95070d');
assert.equal(before['tests/commands/table-text/gnu-evidence.json'], '42e8b27580243212a341edd8b8a106f4d52f81164f5ae56567dd3c738d6a8caa');
assert.equal(before['tests/fs/webdav/mock.ts'], '177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36');
mkdirSync(snapshot, { recursive: true });
for (const path of inputs) {
  if (path.startsWith('node_modules/')) continue;
  mkdirSync(dirname(join(snapshot, path)), { recursive: true });
  cpSync(join(root, path), join(snapshot, path));
}
cpSync(join(root, 'node_modules'), join(snapshot, 'node_modules'), { recursive: true, dereference: true });
mkdirSync(join(work, 'runtime-temp'), { recursive: true });
const after = hashes(root, inputs), frozen = hashes(snapshot, inputs);
assert.deepEqual(drift(before, after), [], 'Input changed during freeze');
assert.deepEqual(drift(after, frozen), [], 'Snapshot differs from actual current inputs');
const scoped = ['src/**/*.ts', ...prior.author, ...prior.independent, ...files(snapshot, 'tests/commands/metadata').filter(path => path.endsWith('.test.ts')), ...files(snapshot, 'tests/commands/table-text-stress/shared-stdin-fix').filter(path => path.endsWith('.test.ts')), join(owned, 'selected-gnu.ts'), join(owned, 'native.ts')];
save(join(snapshot, 'comm-review-types.json'), { extends: './tsconfig.json', compilerOptions: { noEmit: true, paths: { 'virtual-bash': ['./src/index.ts'], 'virtual-bash/commands/table-text': ['./src/commands/table-text/index.ts'] } }, include: scoped });
inputs.add('comm-review-types.json');
for (const path of files(snapshot)) inputs.add(path);
const manifest = hashes(snapshot, inputs);
for (const path of inputs) chmodSync(join(snapshot, path), statSync(join(snapshot, path)).mode & 0o111 ? 0o555 : 0o444);
const sourceHashes = Object.fromEntries(Object.entries(manifest).filter(([path]) => path.startsWith('src/')));
const tableHashes = Object.fromEntries(Object.entries(sourceHashes).filter(([path]) => path.startsWith('src/commands/table-text/')));
const release = readFileSync(ready, 'utf8');
const author = readFileSync('/tmp/safe-bash-comm-fix-result.txt', 'utf8');
const originalInputDeltas = prior.records.filter(row => manifest[row.path] !== row.frozenSha256).map(row => ({ path: row.path, historicalSha256: row.frozenSha256, snapshotSha256: manifest[row.path] }));
const record = { at: new Date().toISOString(), snapshot, headLabelOnly: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), node: { version: process.version, executable: process.execPath, sha256: sha(readFileSync(process.execPath)) }, release: { path: ready, sha256: sha(release), text: release }, author: { sha256: sha(author), text: author }, beforeAfterCopyDrift: drift(before, after), copyDrift: drift(after, frozen), originalInputDeltas, manifest, sourceDigest: sha(JSON.stringify(sourceHashes)), tableDigest: sha(JSON.stringify(tableHashes)), tableHashes, helperSha256: manifest['tests/fs/webdav/mock.ts'], authorTests: prior.author, independentTests: prior.independent, immutable: 'Physical copies including dependencies and native binaries; all recorded files read-only. No live source/helper/dependency symlinks.' };
save(join(work, 'snapshot-manifest.json'), record);
console.log(JSON.stringify({ snapshot, files: inputs.size, sourceDigest: record.sourceDigest, tableDigest: record.tableDigest, helperSha256: record.helperSha256, originalInputDeltas }));
