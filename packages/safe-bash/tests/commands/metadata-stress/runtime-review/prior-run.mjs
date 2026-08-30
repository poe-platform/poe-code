import * as host from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = '/Users/kjopek/Workspace/safe-bash';
const prefix = '/tmp/safe-bash-metadata-review';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeArtifact = (path, content) => {
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
};
const filesUnder = async path => {
  const entries = await host.readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.oracle' || entry.name.startsWith('.native-')) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
};
const manifest = async () => {
  const paths = [...await filesUnder(join(root, 'src')), ...await filesUnder(join(root, 'tests/commands/metadata')), ...await filesUnder(join(root, 'tests/commands/metadata-stress')), ...await filesUnder(join(root, 'node_modules')), ...['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/fs/webdav/mock.ts'].map(path => join(root, path))];
  for (const path of ['coreutils-9.7.tar.xz', ...['chmod', 'stat', 'mktemp'].map(name => `coreutils-9.7/src/${name}`), 'coreutils-9.7/src/chmod.c', 'coreutils-9.7/src/stat.c', 'coreutils-9.7/src/mktemp.c', 'coreutils-9.7/lib/modechange.c']) paths.push(join(root, 'tests/commands/metadata-stress/.oracle', path));
  const files = {};
  for (const path of paths.sort()) files[relative(root, path)] = hash(await host.readFile(path));
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const status = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout;
  return { capturedAt: new Date().toISOString(), head, status, node: process.version, files, digest: hash(JSON.stringify(files)) };
};
const marker = await host.readFile('/tmp/safe-bash-metadata-fixer.closed', 'utf8');
const before = await manifest();
writeArtifact(`${prefix}-before.json`, JSON.stringify({ marker, ...before }, null, 2));
const commands = [
  ['author', process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', ...((await filesUnder(join(root, 'tests/commands/metadata'))).filter(path => path.endsWith('.test.ts')))]],
  ['stress', process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', ...((await filesUnder(join(root, 'tests/commands/metadata-stress'))).filter(path => path.endsWith('.test.ts')))]],
  ['probe', process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', `${prefix}-probe.mjs`]],
  ['types', join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node', ...((await filesUnder(join(root, 'tests/commands/metadata'))).filter(path => path.endsWith('.ts'))), ...((await filesUnder(join(root, 'tests/commands/metadata-stress'))).filter(path => path.endsWith('.ts')))]]
];
const results = [];
for (const [label, command, args] of commands) {
  if (label === 'author' || label === 'stress') args.unshift('--import', `${prefix}-native-count.mjs`);
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const record = { label, command, args, started, finished: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message, stdoutHash: hash(result.stdout ?? ''), stderrHash: hash(result.stderr ?? '') };
  writeArtifact(`${prefix}-${label}.log`, `${JSON.stringify(record)}\nSTDOUT\n${result.stdout ?? ''}\nSTDERR\n${result.stderr ?? ''}`);
  console.log(label, result.status, result.signal, result.stdout?.slice(-1200), result.stderr?.slice(-1200));
  results.push(record);
}
const after = await manifest();
writeArtifact(`${prefix}-after.json`, JSON.stringify(after, null, 2));
const changed = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(path => before.files[path] !== after.files[path]);
writeArtifact(`${prefix}-execution.json`, JSON.stringify({ beforeDigest: before.digest, afterDigest: after.digest, beforeHead: before.head, afterHead: after.head, changed, results }, null, 2));
console.log(JSON.stringify({ beforeDigest: before.digest, afterDigest: after.digest, beforeHead: before.head, afterHead: after.head, changed }, null, 2));
