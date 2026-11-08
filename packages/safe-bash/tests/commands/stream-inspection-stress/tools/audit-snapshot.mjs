import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const base = '/tmp/safe-bash-stream-verifier-20260827-A';
const target = readFileSync(join(base, 'latest-snapshot.txt'), 'utf8').trim();
const manifest = JSON.parse(readFileSync(join(target, 'SNAPSHOT.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mismatches = [];
for (const [path, expected] of Object.entries(manifest.snapshotHashes)) {
  const actual = typeof expected === 'string' ? hash(readFileSync(join(target, path))) : { symlink: readlinkSync(join(target, path)) };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push({ path, expected, actual });
}
const resolution = spawnSync(process.execPath, ['--input-type=module', '-e', `console.log(JSON.stringify({tsx:import.meta.resolve('tsx'),typescript:import.meta.resolve('typescript'),esbuild:import.meta.resolve('esbuild'),cwd:process.cwd()}))`], { cwd: target, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 3000 });
if (resolution.status !== 0 || resolution.error) throw Error('Resolution audit failed');
const resolved = JSON.parse(resolution.stdout);
if (![resolved.tsx, resolved.typescript, resolved.esbuild].every(path => path.includes(target.split('/').at(-1)))) throw Error('Escaped dependency resolution');
const first = JSON.parse(readFileSync(join(base, 'snapshot-2026-08-27T04-55-00-806Z/SNAPSHOT.json'), 'utf8'));
const delta = Object.entries(manifest.sourceHashes).filter(([path, digest]) => first.sourceHashes[path] !== digest).map(([path, digest]) => ({ path, initial: first.sourceHashes[path], actual: digest }));
const report = { at: new Date().toISOString(), target, snapshotHash: hash(readFileSync(join(target, 'SNAPSHOT.json'))), mismatches, resolved, initialSourceDelta: delta, sourceCount: Object.keys(manifest.sourceHashes).length, runtimeBefore: manifest.runtime.sha256, runtimeAfter: hash(readFileSync(process.execPath)), boundary: 'Runtime executable hashed before/after; system runtime/dylibs not copied, OS immutable lifetime not assumed. Installed dependencies and source/config copied with before/copied/after hashes and internal relative symlink assertions. Config explicit TSX_TSCONFIG_PATH, cache disabled, isolated CWD and whitelist environment; no root dist lookup.' };
writeFileSync(join(target, 'post-run-audit.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
process.exitCode = mismatches.length || report.runtimeBefore !== report.runtimeAfter ? 1 : 0;
