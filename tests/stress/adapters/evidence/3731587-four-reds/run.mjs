import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = '/Users/kjopek/Workspace/safe-bash';
const original = '/tmp/safe-bash-fs-3731587-refresh-kMXBVH';
const archive = join(root, 'archive');
const pin = '3731587fa287333ca59c7a81569b367cec66f61d';
const hash = data => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo });
const paths = git('ls-tree', '-r', '--name-only', pin, '--', 'src/contracts', 'src/fs/s3', 'src/fs/webdav', 'tests/stress/adapters', 'tests/fs/conformance/fixtures.ts', 'tests/fs/webdav/mock.ts', 'tests/fs/webdav/property-fixture.ts', 'package.json', 'package-lock.json').toString().trim().split('\n');
const manifest = () => paths.map(path => ({ path, blob: git('rev-parse', `${pin}:${path}`).toString().trim(), sha256: hash(readFileSync(join(archive, path))), originalArchiveSha256: hash(readFileSync(join(original, 'archive', path))), committedSha256: hash(git('show', `${pin}:${path}`)) }));
const originalManifest = () => Object.fromEntries(readdirSync(original, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => [entry.name, hash(readFileSync(join(original, entry.name)))]));
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
const before = manifest();
for (const entry of before) assert.equal(entry.sha256, entry.committedSha256);
for (const entry of before) assert.equal(entry.sha256, entry.originalArchiveSha256);
const originalBefore = originalManifest();
save('manifest-before.json', before);
save('original-manifest-before.json', originalBefore);
save('provenance.json', { pin, original, archive, node: process.version, started: new Date().toISOString(), liveHead: git('rev-parse', 'HEAD').toString().trim(), paths: paths.length, archiveSha256: hash(readFileSync(join(root, 'committed.tar'))), tooling: Object.fromEntries(['tsx', 'typescript', 'esbuild', '@types/node'].map(name => [name, JSON.parse(readFileSync(join(archive, 'node_modules', name, 'package.json'))).version])) });
const commands = [
  { name: 'original-four', args: ['--import', 'tsx', '--test', '--test-name-pattern=^(s3: optional metadata capabilities are exercised or fail closed|s3: optional truncate preserves exact bytes or rejects without mutation|webdav: optional metadata capabilities are exercised or fail closed|s3: default rename explicitly fails closed without opt-in)$', 'tests/stress/adapters/core.test.ts', 'tests/stress/adapters/s3.test.ts'] },
  { name: 'observations', args: ['--import', 'tsx', '../observe.mjs'] },
];
for (const command of commands) {
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, command.args, { cwd: archive, encoding: 'utf8', timeout: 30000, env: { ...process.env, TMPDIR: root, TSX_DISABLE_CACHE: '1' } });
  writeFileSync(join(root, `${command.name}.stdout`), result.stdout ?? '');
  writeFileSync(join(root, `${command.name}.stderr`), result.stderr ?? '');
  save(`${command.name}.exit.json`, { argv: [process.execPath, ...command.args], cwd: archive, start, end: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message });
  console.log(command.name, result.status);
}
const after = manifest();
const originalAfter = originalManifest();
save('manifest-after.json', after);
save('original-manifest-after.json', originalAfter);
assert.deepEqual(after, before);
assert.deepEqual(originalAfter, originalBefore);
save('stability.json', { scopedFilesUnchanged: true, originalTopLevelFilesUnchanged: true, originalTopLevelCount: Object.keys(originalBefore).length, completed: new Date().toISOString() });
