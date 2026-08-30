import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const repo = '/Users/kjopek/Workspace/safe-bash';
const archive = join(root, 'archive');
const original = '/tmp/safe-bash-overlay-rmdir-3a9177a-AGvOuU';
const pin = '50f517d4e28281ccba8c7580d017fe65a4bf8e20';
const scopes = ['src/fs', 'tests/fs', 'tests/stress/adapters', 'tests/stress/s3-policy', 'tests/stress/remote-cancellation', 'tests/integration/adapter-tools', 'tests/integration/adapter-tools-diagnostics'];
const backends = ['memory', 'real', 's3', 'webdav', 'readonly', 'mount', 'overlay'];
const git = (...args) => execFileSync('git', args, { cwd: repo });
const hash = data => createHash('sha256').update(data).digest('hex');
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
const tree = (ref, path) => git('rev-parse', `${ref}:${path}`).toString().trim();
const paths = git('ls-tree', '-r', '--name-only', pin, '--', 'src', ...scopes, 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().trim().split('\n').filter(path => !path.includes('/evidence/'));
const manifest = () => paths.map(path => ({ path, blob: tree(pin, path), sha256: hash(readFileSync(join(archive, path))) }));
const liveSnapshot = () => ({
  head: git('rev-parse', 'HEAD').toString().trim(),
  srcTree: tree('HEAD', 'src'), fsTree: tree('HEAD', 'src/fs'),
  broadStatus: git('status', '--porcelain=v1', '--untracked-files=all', '--', ...scopes).toString(),
  sevenStatus: git('status', '--porcelain=v1', '--untracked-files=all', '--', ...backends.flatMap(name => [`src/fs/${name}`, `tests/fs/${name}`])).toString(),
  pinToLiveFsDiff: git('diff', pin, '--', ...scopes).toString(),
  indexDiff: git('diff', '--cached', '--', ...scopes).toString(),
  files: paths.filter(path => scopes.some(scope => path.startsWith(scope + '/'))).map(path => ({ path, sha256: hash(readFileSync(join(repo, path))) })),
});
const originalManifest = () => Object.fromEntries(readdirSync(original, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => [entry.name, hash(readFileSync(join(original, entry.name)))]));
const before = manifest();
for (const entry of before) assert.equal(entry.sha256, hash(git('show', `${pin}:${entry.path}`)));
const liveBefore = liveSnapshot();
const originalBefore = originalManifest();
save('manifest-before.json', before);
save('live-before.json', liveBefore);
save('original-stability-before.json', originalBefore);
save('trees.json', { pin, src: tree(pin, 'src'), fs: tree(pin, 'src/fs'), backends: Object.fromEntries(backends.map(name => [name, { source: tree(pin, `src/fs/${name}`), tests: tree(pin, `tests/fs/${name}`) }])), sourceTarSha256: hash(readFileSync(join(root, 'source.tar'))) });
save('tooling.json', { node: process.version, packages: Object.fromEntries(['tsx', 'typescript', 'esbuild', '@types/node'].map(name => [name, JSON.parse(readFileSync(join(archive, 'node_modules', name, 'package.json'))).version])) });
const readonlyPaths = ['tests/fs/readonly/readonly.test.ts', 'tests/fs/readonly/conformance.test.ts'];
const readonly = readonlyPaths.map(path => ({ path, originalBlob: tree('3a9177a', path), fixedBlob: tree(pin, path), same: tree('3a9177a', path) === tree(pin, path) }));
save('readonly-fixes.json', readonly);
assert.ok(readonly.every(entry => entry.same));
writeFileSync(join(root, 'readonly-original-fix.patch'), git('show', '3a9177a', '--', ...readonlyPaths));
const matrixPaths = ['tests/integration/adapter-tools/matrix.test.ts', 'tests/integration/adapter-tools/fixtures.ts'];
save('matrix-identity.json', matrixPaths.map(path => ({ path, pinBlob: tree(pin, path), priorFrozenBlob: tree('3731587', path), unchangedSincePriorFrozen: tree(pin, path) === tree('3731587', path), sha256: hash(readFileSync(join(archive, path))) })));
const entrypoints = paths.filter(path => path.endsWith('.ts') && scopes.some(scope => path.startsWith(scope + '/')));
save('typecheck-entrypoints.json', entrypoints);
const commands = [
  { name: 'observations', args: ['--unhandled-rejections=strict', '--import', 'tsx', '../probe.mjs'] },
  { name: 'matrix79', args: ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', 'tests/integration/adapter-tools/matrix.test.ts'] },
  { name: 'types-fs', args: ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node', ...entrypoints] },
];
for (const command of commands) {
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, command.args, { cwd: archive, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TMPDIR: root, TSX_DISABLE_CACHE: '1' } });
  writeFileSync(join(root, `${command.name}.stdout`), result.stdout ?? '');
  writeFileSync(join(root, `${command.name}.stderr`), result.stderr ?? '');
  save(`${command.name}.exit.json`, { argv: [process.execPath, ...command.args], cwd: archive, start, end: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message });
  console.log(command.name, result.status);
}
const after = manifest();
const liveAfter = liveSnapshot();
const originalAfter = originalManifest();
save('manifest-after.json', after);
save('live-after.json', liveAfter);
save('original-stability-after.json', originalAfter);
assert.deepEqual(after, before);
assert.deepEqual(originalAfter, originalBefore);
save('stability.json', { archiveFiles: before.length, archiveStable: true, originalArtifactCount: Object.keys(originalBefore).length, originalStable: true, liveFsFilesStable: JSON.stringify(liveAfter.files) === JSON.stringify(liveBefore.files), liveFsTreeStable: liveBefore.fsTree === liveAfter.fsTree, liveFsMatchesPin: liveAfter.pinToLiveFsDiff === '', fsTypecheckEntrypoints: entrypoints.length });
const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,etime=,args='], { encoding: 'utf8' });
writeFileSync(join(root, 'processes-at-runner-finish.txt'), processes);
save('own-processes-at-runner-finish.json', { runnerPid: process.pid, parentPid: process.ppid, note: 'All three synchronous child commands returned; runner is still alive for this final capture.', matches: processes.split('\n').filter(line => line.includes(root)) });
