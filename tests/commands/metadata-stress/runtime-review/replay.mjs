import assert from 'node:assert/strict';
import * as host from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const prefix = process.argv[2] ?? '/tmp/safe-bash-metadata-runtime-final';
assert.match(prefix, /^\/tmp\/safe-bash-metadata-runtime-[a-z0-9-]+$/u);
const markerPath = '/tmp/safe-bash-metadata-runtime-fixes.closed';
const marker = await host.readFile(markerPath, 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, content) => {
  const result = spawnSync('apply_patch', [], { cwd: root, encoding: 'utf8', input: `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
};
const filesUnder = async path => {
  const files = [];
  for (const entry of await host.readdir(path, { withFileTypes: true })) {
    if (entry.name === '.oracle' || entry.name.startsWith('.native-') || entry.name === 'runtime-review') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
};
const manifest = async () => {
  const paths = [];
  for (const directory of ['src', 'tests/commands/metadata', 'tests/commands/metadata-stress', 'node_modules']) paths.push(...await filesUnder(join(root, directory)));
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/fs/webdav/mock.ts', 'tests/plugins/agent-commands.test.ts', 'tests/plugins/safejs-exports.test.ts']) paths.push(join(root, path));
  const oracle = join(root, 'tests/commands/metadata-stress/.oracle');
  for (const path of ['coreutils-9.7.tar.xz', 'coreutils-9.7/src/chmod', 'coreutils-9.7/src/stat', 'coreutils-9.7/src/mktemp', 'coreutils-9.7/src/chmod.c', 'coreutils-9.7/src/stat.c', 'coreutils-9.7/src/mktemp.c', 'coreutils-9.7/lib/modechange.c']) paths.push(join(oracle, path));
  for (const name of ['replay.mjs', 'audit-original-tests.mjs', 'prior-probe.mjs', 'prior-calibrate.mjs', 'native-count.mjs', 'calibration.mjs', 'original141.json']) paths.push(join(owned, name));
  const files = {};
  for (const path of paths.sort()) files[relative(root, path)] = hash(await host.readFile(path));
  return { capturedAt: new Date().toISOString(), head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), gitStatus: spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout, node: process.version, files, digest: hash(JSON.stringify(files)) };
};
const before = await manifest();
const closure = JSON.parse(marker);
assert.equal(closure.productionAndOwnedTestsFrozen, true);
for (const [path, digest] of Object.entries(closure.hashes)) assert.equal(before.files[path], digest, `fixer closure hash: ${path}`);
const authorEvidence = JSON.parse(await host.readFile(join(root, 'tests/commands/metadata-stress/oracle-evidence.json'), 'utf8'));
for (const [name, digest] of Object.entries(authorEvidence.authorFilesSha256)) assert.equal(before.files[`tests/commands/metadata/${name}`], digest, `original author hash: ${name}`);
save(`${prefix}-before.json`, JSON.stringify({ markerPath, marker, ...before }, null, 2));
const authorFiles = (await filesUnder(join(root, 'tests/commands/metadata'))).filter(path => path.endsWith('.test.ts'));
const stressFiles = (await filesUnder(join(root, 'tests/commands/metadata-stress'))).filter(path => path.endsWith('.test.ts'));
const nodeArgs = ['--unhandled-rejections=strict', '--import', 'tsx'];
const testArgs = [...nodeArgs, '--import', join(owned, 'native-count.mjs'), '--test'];
const typeFiles = [...await filesUnder(join(root, 'tests/commands/metadata')), ...await filesUnder(join(root, 'tests/commands/metadata-stress'))].filter(path => path.endsWith('.ts'));
const commands = [
  ['author', process.execPath, [...testArgs, ...authorFiles]],
  ['plugin', process.execPath, [...testArgs, 'tests/plugins/agent-commands.test.ts']],
  ['safejs-plugin', process.execPath, [...testArgs, 'tests/plugins/safejs-exports.test.ts']],
  ['stress', process.execPath, [...testArgs, ...stressFiles]],
  ['input-audit', process.execPath, [join(owned, 'audit-original-tests.mjs')]],
  ['probe', process.execPath, [...nodeArgs, join(owned, 'prior-probe.mjs')]],
  ['prior-calibrate', process.execPath, [...nodeArgs, join(owned, 'prior-calibrate.mjs')]],
  ['calibration', process.execPath, [...nodeArgs, join(owned, 'calibration.mjs')]],
  ['types', join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node', ...typeFiles]],
];
const results = [];
for (const [label, command, args] of commands) {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, METADATA_ORIGINAL: join(owned, 'original141.json'), METADATA_CALIBRATION_OUTPUT: `${prefix}-calibration.json` } });
  const record = { label, command, args, started, finished: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message, stdoutHash: hash(result.stdout ?? ''), stderrHash: hash(result.stderr ?? '') };
  if (['author', 'plugin', 'safejs-plugin', 'stress'].includes(label)) record.tap = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  save(`${prefix}-${label}.log`, `${JSON.stringify(record)}\nSTDOUT\n${result.stdout ?? ''}\nSTDERR\n${result.stderr ?? ''}`);
  results.push(record);
  console.log(JSON.stringify({ label, exitCode: result.status, tap: record.tap }));
}
const after = await manifest();
save(`${prefix}-after.json`, JSON.stringify(after, null, 2));
const changed = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(path => before.files[path] !== after.files[path]);
const summary = { markerPath, markerHash: hash(marker), beforeDigest: before.digest, afterDigest: after.digest, beforeHead: before.head, afterHead: after.head, changed, results, activeOwnedChildProcesses: 0, note: 'Probe exit1 is retained when native differences remain; this runner does not convert differences into success or alter expectations.' };
save(`${prefix}-execution.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ beforeDigest: before.digest, afterDigest: after.digest, changed, activeOwnedChildProcesses: 0 }, null, 2));
if (changed.length || results.some(result => result.exitCode !== 0)) process.exitCode = 1;
