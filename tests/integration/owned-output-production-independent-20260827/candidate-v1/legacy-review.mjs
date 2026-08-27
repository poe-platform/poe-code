import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url)), repo = join(own, '../../../..');
const state = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state));
const ts = (await import(pathToFileURL(join(repo, 'node_modules/typescript/lib/typescript.js')))).default;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024 });
const entries = new Set(git(['ls-tree', '-r', '--name-only', state.candidate]).toString().trim().split('\n'));
const legacy = [
  'tests/contracts/io.test.ts', 'tests/contracts/io.stress.test.ts', 'tests/contracts/command.test.ts',
  'tests/contracts/invocation-cleanup.test.ts', 'tests/contracts/invoke.test.ts', 'tests/contracts/stdin-provenance.test.ts',
  'tests/shell/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup-setup.test.ts', 'tests/shell/invocation-cleanup-lifecycle.test.ts',
  'tests/shell/invocation-cleanup-pipeline.test.ts', 'tests/shell/input-return-cleanup.test.ts',
  'tests/shell/output-accounting.test.ts', 'tests/shell/output-accounting-bounds.test.ts',
  'tests/shell/pipeline-effects.test.ts', 'tests/shell/streaming.test.ts', 'tests/shell/invoke.test.ts', 'tests/shell/stdin-origin.test.ts',
  'tests/commands/streams.test.ts', 'tests/commands/pipelines.test.ts',
  'tests/commands/network/byte-ownership.test.ts', 'tests/commands/network/exports.test.ts',
  'tests/commands/network/files.test.ts', 'tests/commands/network/http.test.ts', 'tests/commands/network/safety.test.ts',
  'tests/commands/network/tls.test.ts', 'tests/commands/network/zero-caps.test.ts', 'tests/commands/network-zero-caps-review/holdout.test.ts',
];
const additional = ['tests/shell/remote-close.test.ts', 'tests/shell/first-read-probe.ts', 'tests/shell/remote-close-probe.ts', 'tests/shell/output-accounting-bounds.ts', 'tests/commands/network/tls/cert.pem', 'tests/commands/network/tls/key.pem'];
const inputs = {};
function extract(path) {
  if (path in inputs || path.startsWith('src/')) return;
  assert(entries.has(path), 'missing frozen input ' + path);
  const bytes = git(['show', state.candidate + ':' + path]); inputs[path] = hash(bytes);
  const target = join(state.product, path); mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) assert.equal(hash(readFileSync(target)), inputs[path]); else writeFileSync(target, bytes);
  if (!/\.[cm]?[jt]s$/u.test(path)) return;
  for (const imported of ts.preProcessFile(bytes.toString(), true, true).importedFiles) {
    if (!imported.fileName.startsWith('.')) continue;
    const relative = posix.normalize(posix.join(posix.dirname(path), imported.fileName));
    const resolved = [relative, relative.replace(/\.js$/u, '.ts'), relative + '.ts', relative + '/index.ts'].find(name => entries.has(name));
    assert(resolved, 'unresolved frozen import ' + path + ':' + relative); extract(resolved);
  }
}
for (const path of [...legacy, ...additional]) extract(path);
function inventory(root) {
  const result = {};
  function walk(directory, prefix) { for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), stat = lstatSync(path), relative = prefix + name;
    assert(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) { result[relative + '/'] = 'directory'; walk(path, relative + '/'); }
    else { assert(stat.isFile()); result[relative] = hash(readFileSync(path)); }
  } }
  walk(root, ''); return result;
}
const protectedBefore = Object.fromEntries(['src', 'scripts', 'dist', 'tests'].map(path => [path, inventory(join(state.product, path))]));
const output = mkdtempSync(join(state.work, 'legacy-review-')), rows = [];
for (const [id, files, options] of [
  ['legacy', legacy, []],
  ['original-first-read', ['tests/shell/remote-close.test.ts'], ['--test-name-pattern=^hard-deadline pipeline close: first-read-']],
]) {
  const args = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=2', ...options, ...files];
  const child = spawnSync(state.node, args, { cwd: state.product, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH: dirname(state.node) + ':/usr/bin:/bin', NODE_OPTIONS: '', TZ: 'UTC' } });
  writeFileSync(join(output, id + '.stdout'), child.stdout ?? ''); writeFileSync(join(output, id + '.stderr'), child.stderr ?? '');
  const counts = Object.fromEntries(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, Number(child.stdout?.match(new RegExp('^# ' + name + ' (\\d+)$', 'mu'))?.[1])]));
  rows.push({ id, args, status: child.status, signal: child.signal, error: child.error?.message, counts }); console.log(id, JSON.stringify(rows.at(-1)));
}
for (const [path, before] of Object.entries(protectedBefore)) assert.deepEqual(inventory(join(state.product, path)), before, path);
const sourceFacts = Object.fromEntries(['src/shell/input.ts', 'src/commands/network/shared.ts'].map(path => {
  const before = git(['show', state.baseline + ':' + path]), after = git(['show', state.candidate + ':' + path]); assert.deepEqual(before, after); return [path, hash(after)];
}));
writeFileSync(join(output, 'REPORT.json'), JSON.stringify({ candidate: state.candidate, packageSHA256: state.packageSHA256, node: state.node, nodeSHA256: state.nodeSHA256, inputs, unchangedSharedInputs: sourceFacts, protectedUnchanged: true, rows }, null, 2)); console.log('LEGACY REPORT', output);
