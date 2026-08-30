import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { copyRegular, git, hash, inventory, json, save } from '../execution-prep-v1/artifacts.mjs';
import { supervise } from '../execution-prep-v1/protocol.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), owned = dirname(scope), repo = resolve(owned, '../../..');
const [preseal, label] = process.argv.slice(2); assert.match(preseal, /^[a-f0-9]{40}$/u); assert.match(label, /^[a-z0-9-]+$/u);
const seal = json(join(scope, 'SEAL.json'));
for (const [name, digest] of Object.entries(seal)) {
  assert.equal(hash(readFileSync(join(scope, name))), digest);
  assert.equal(hash(git(repo, ['show', `${preseal}:tests/shell/let-independent-20260828/regressions-v1/${name}`])), digest);
}
const binding = json(join(scope, 'BINDINGS.json')), selected = json(join(owned, 'BINDINGS.json')), tools = json(join(owned, 'execution-prep-v1/TOOLS.json'));
assert.equal(realpathSync(process.execPath), tools.node.path); assert.equal(hash(readFileSync(process.execPath)), tools.node.sha256);
const output = join(owned, `regression-results-${label}`); assert.equal(existsSync(output), false); mkdirSync(output);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'let-regressions-'))), source = join(scratch, 'source'); mkdirSync(source);
const report = { preseal, binding, node: tools.node, source: {}, runs: [], completed: false, nativeExecutions: 0 };
try {
  for (const entry of [...selected.source, ...binding.testInputs]) {
    const runtime = entry.path === 'src/shell/runtime.ts';
    const bytes = git(repo, ['show', `${runtime ? binding.candidate : entry.revision}:${entry.path}`]);
    assert.equal(hash(bytes), runtime ? binding.sourceRuntime : entry.sha256);
    const target = join(source, entry.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
    chmodSync(target, entry.mode ? entry.mode & 0o777 : 0o644); report.source[entry.path] = hash(bytes);
  }
  for (const tree of [...tools.trees.filter(tree => tree.role === 'compiler'), ...binding.tools]) {
    assert.deepEqual(inventory(tree.path), tree.files); copyRegular(tree.path, join(source, 'node_modules', tree.name));
  }
  const env = { PATH: dirname(process.execPath), HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', ESBUILD_BINARY_PATH: join(source, 'node_modules/@esbuild/darwin-arm64/bin/esbuild') };
  const run = await supervise(process.execPath, ['--unhandled-rejections=strict', '--import', join(source, 'node_modules/tsx/dist/loader.mjs'), '--test', '--test-reporter=tap', '--test-concurrency=1', ...binding.regressions], { cwd: source, env, timeoutMs: 180000, maxBytes: 2 * 1024 * 1024 });
  save(join(output, 'raw.json'), run); report.runs.push({ file: 'raw.json', sha256: hash(readFileSync(join(output, 'raw.json'))) });
  assert.equal(run.code, 0); assert.equal(run.signal, null); assert.equal(run.spawnError, null); assert.equal(run.failure, null); assert.equal(run.groupAbsent, true);
  for (const [name, count] of [['tests', 167], ['pass', 167], ['fail', 0], ['cancelled', 0], ['skipped', 0], ['todo', 0]]) assert.match(run.stdout, new RegExp(`^# ${name} ${count}$`, 'm'));
  for (const [path, digest] of Object.entries(report.source)) assert.equal(hash(readFileSync(join(source, path))), digest);
  report.pass = 167; report.completed = true;
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; }
finally { rmSync(scratch, { recursive: true, force: true }); report.scratchRemoved = !existsSync(scratch); save(join(output, 'REPORT.json'), report); }
process.stdout.write(JSON.stringify({ completed: report.completed, pass: report.pass, failure: report.failure?.message, output }) + '\n');
if (!report.completed) process.exitCode = 1;
