import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import * as api from 'virtual-bash';
import * as leaf from 'virtual-bash/commands/git';
import { expectedNames } from './names.mjs';

const neutral = JSON.parse(await fs.readFile(new URL('fixture.json', import.meta.url)));
const packedData = JSON.parse(await fs.readFile(new URL('packs.json', import.meta.url)));
const rows = [], shells = new Set();
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const host = commands => ({ commands, use() { throw Error('unexpected middleware'); }, registerFileSystem() { throw Error('unexpected filesystem'); } });
async function put(memory, name, bytes) { await memory.mkdir(path.posix.dirname(name), { recursive: true }); await memory.writeFile(name, bytes); }
async function memoryFixture() {
  const memory = new api.MemoryFileSystem();
  for (const item of neutral.files) { await put(memory, '/repo/' + item.path, item.text === undefined ? Buffer.from(item.base64, 'base64') : Buffer.from(item.text)); await memory.chmod('/repo/' + item.path, item.mode); }
  return memory;
}
async function installPack(memory, fixture, remove = false) {
  if (remove) for (const name of packedData.workflowTransformation.removeExactly) await memory.rm('/repo/' + name);
  const pack = Buffer.from(fixture.packBase64, 'base64');
  const stem = '/repo/.git/objects/pack/pack-' + pack.subarray(-20).toString('hex');
  await put(memory, stem + '.pack', pack); await put(memory, stem + '.idx', Buffer.from(fixture.indexBase64, 'base64'));
  return stem;
}
function shellFor(memory, options = {}, cwd = '/repo') {
  const shell = new api.Shell({ fs: memory, cwd }).use(api.agentCommands(options)); shells.add(shell); return shell;
}
async function record(id, run) {
  if (process.env.PUBLIC_CASE && id !== process.env.PUBLIC_CASE) return;
  const timer = setTimeout(() => { console.error('PUBLIC_CASE_DEADLINE', id); process.exit(78); }, 30000);
  const row = { id, pass: false };
  try { await run(); row.pass = true; } catch (error) { row.error = String(error?.stack ?? error); }
  finally {
    const settled = await Promise.allSettled([...shells].map(shell => shell.dispose()));
    row.shells = shells.size; row.closed = settled.filter(item => item.status === 'fulfilled').length;
    if (row.closed !== row.shells) { row.pass = false; row.cleanupFailure = true; }
    shells.clear(); clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupFailure) process.exit(78);
}
async function object(memory, type, bytes) {
  const body = Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes]);
  const oid = createHash('sha1').update(body).digest('hex');
  await put(memory, `/repo/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`, deflateSync(body)); return oid;
}
await record('G01-public-exports', async () => {
  for (const name of ['createGitCommand', 'createGitCommands', 'gitCommands']) assert.equal(api[name], leaf[name]);
  assert.equal(api.createGitCommand().name, 'git'); assert.deepEqual(api.createGitCommands().map(command => command.name), ['git']);
  const root = await fs.realpath(process.env.PRODUCT_ROOT);
  assert.equal(await fs.realpath(fileURLToPath(import.meta.resolve('virtual-bash'))), path.join(root, 'dist/index.js'));
  assert.equal(await fs.realpath(fileURLToPath(import.meta.resolve('virtual-bash/commands/git'))), path.join(root, 'dist/commands/git/index.js'));
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.deepEqual(metadata.exports['./commands/git'], { types: './dist/commands/git/index.d.ts', import: './dist/commands/git/index.js' });
  assert.equal('GIT_LIMITS' in api, false);
});
await record('G02-exact80', async () => {
  assert.equal(expectedNames.length, 80); assert.equal(new Set(expectedNames).size, 80);
  assert.deepEqual(api.createAgentCommands().map(command => command.name).sort(), expectedNames);
  for (const name of ['curl', 'safejs', 'node', 'npm', 'npx', 'yq', 'xan', 'getopts']) assert.ok(!expectedNames.includes(name));
  const shell = shellFor(await memoryFixture()); await shell.exec('true'); assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expectedNames);
});
await record('G03-standalone', async () => {
  const shell = new api.Shell({ fs: await memoryFixture(), cwd: '/repo' }).use(api.gitCommands()); shells.add(shell);
  const result = await shell.exec('git rev-parse HEAD'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, neutral.oids.headCommit + '\n'); assert.equal(result.stderr, ''); assert.equal(shell.commands.list().length, 1);
});
await record('G04-collision-global-false', () => {
  const commands = new api.CommandRegistry([{ name: 'git', execute: () => ({ exitCode: 19 }) }]); const original = commands.get('git');
  assert.throws(() => api.agentCommands({ git: { replace: true } }).setup(host(commands)), /already registered/); assert.equal(commands.list().length, 1); assert.equal(commands.get('git'), original);
});
await record('G05-replace-global-true', () => {
  const commands = new api.CommandRegistry([{ name: 'git', execute: () => ({ exitCode: 19 }) }, { name: 'custom', execute: () => ({ exitCode: 17 }) }]);
  const previous = commands.get('git'), custom = commands.get('custom');
  api.agentCommands({ replace: true, git: { replace: false } }).setup(host(commands)); assert.equal(commands.list().length, 81); assert.notEqual(commands.get('git'), previous); assert.equal(commands.get('custom'), custom);
});
await record('G06-discovery-boundary', async () => {
  const memory = await memoryFixture(); await memory.mkdir('/repo/sub');
  const allowed = shellFor(memory, { git: { discoveryBoundary: '/repo' } }, '/repo/sub'); const good = await allowed.exec('git rev-parse --show-toplevel'); assert.equal(good.exitCode, 0); assert.equal(good.stdout, '/repo\n');
  const denied = shellFor(memory, { git: { discoveryBoundary: '/repo/sub' } }, '/repo/sub'); const bad = await denied.exec('git rev-parse HEAD'); assert.equal(bad.exitCode, 128); assert.equal(bad.stdout, ''); assert.ok(bad.stderr.length > 0);
});
await record('G07-fixed-options', () => {
  for (const options of [{ limits: {} }, { maxReadBytes: 1 }, { discoveryBoundary: 3 }, { spawn: true }]) assert.throws(() => api.createGitCommand(options), TypeError);
  assert.throws(() => api.createAgentCommands({ git: { limits: {} } }), TypeError);
  assert.throws(() => api.createGitCommands({ discoveryBoundary: 'relative' }), TypeError);
});
await record('G08-standalone-replacement', async () => {
  const commands = new api.CommandRegistry([{ name: 'git', execute: () => ({ exitCode: 17 }) }]); const prior = commands.get('git');
  api.gitCommands({ replace: true }).setup(host(commands)); assert.notEqual(commands.get('git'), prior);
  assert.throws(() => api.gitCommands().setup(host(commands)), /already registered/);
});
await record('G09-readonly-packed', async () => {
  const memory = await memoryFixture(); await installPack(memory, packedData.fixtures[0], true);
  const before = Buffer.from(await memory.readFile('/repo/.git/index'));
  const result = await shellFor(api.createReadOnlyFileSystem(memory)).exec('git status --porcelain=v1 --no-renames -uall');
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, neutral.proposedOutputs[0].stdout); assert.deepEqual(Buffer.from(await memory.readFile('/repo/.git/index')), before);
});
await record('G10-pipeline', async () => {
  const result = await shellFor(await memoryFixture()).exec('git ls-files | head -n 1'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'README.md\n'); assert.equal(result.stderr, '');
});
await record('G11-apply-crossfeature', async () => {
  const memory = await memoryFixture(), shell = shellFor(memory);
  const patch = '*** Begin Patch\n*** Update File: src/app.txt\n@@\n-working\n+patched\n*** End Patch\n';
  const changed = await shell.exec('apply_patch', { stdin: patch }); assert.equal(changed.exitCode, 0, changed.stderr);
  const result = await shell.exec('git diff --name-only | cat'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'src/app.txt\n'); assert.equal(Buffer.from(await memory.readFile('/repo/src/app.txt')).toString(), 'patched\n');
});
await record('G12-array-function', async () => {
  const result = await shellFor(await memoryFixture()).exec('args=(rev-parse HEAD); f(){ git "${args[@]}"; }; f | cat'); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, neutral.oids.headCommit + '\n');
});
await record('G13-preaborted-caller', async () => {
  const reason = { caller: true }, controller = new AbortController(); controller.abort(reason);
  await assert.rejects(shellFor(await memoryFixture()).exec('git status --short', { signal: controller.signal }), error => error === reason);
});
await record('G14-corrupt-pack-before-output', async () => {
  const memory = await memoryFixture(), stem = await installPack(memory, packedData.fixtures[0]); const bytes = Buffer.from(await memory.readFile(stem + '.pack')); bytes[bytes.length - 1] ^= 1; await memory.writeFile(stem + '.pack', bytes);
  const result = await shellFor(memory).exec('git rev-parse --show-toplevel'); assert.equal(result.exitCode, 128); assert.equal(result.stdout, ''); assert.ok(result.stderr.length > 0);
});
await record('G15-unsupported-storage', async () => {
  const memory = await memoryFixture(); await memory.writeFile('/repo/.git/shallow', Buffer.from(neutral.oids.headCommit + '\n'));
  const result = await shellFor(memory).exec('git rev-parse HEAD'); assert.equal(result.exitCode, 128); assert.equal(result.stdout, ''); assert.match(result.stderr, /shallow|unsupported/);
});
await record('G16-usage-not-version-stub', async () => {
  const result = await shellFor(await memoryFixture()).exec('git --version'); assert.equal(result.exitCode, 129); assert.equal(result.stdout, ''); assert.ok(result.stderr.length > 0);
});
await record('G17-diff-exit-one', async () => {
  const result = await shellFor(await memoryFixture()).exec('git diff --quiet'); assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
await record('G18-stdout-backpressure', async () => {
  const shell = shellFor(await memoryFixture()); let enter, release, settled = false; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
  const execution = shell.exec('git show HEAD:src/app.txt', { stdout: { async write() { enter(); await held; } } }); execution.then(() => { settled = true; }, () => { settled = true; });
  try { await entered; await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); } finally { release(); }
  assert.equal((await execution).exitCode, 0);
});
for (const storage of ['loose', 'P01', 'P02']) for (const [index, workflow] of neutral.proposedOutputs.entries()) await record(`${storage}-workflow-${index + 1}`, async () => {
  const memory = await memoryFixture(); if (storage !== 'loose') await installPack(memory, packedData.fixtures.find(item => item.id === storage), true);
  const result = await shellFor(memory).exec(['git', ...workflow.args].map(quote).join(' ')); assert.equal(result.exitCode, workflow.exitCode, result.stderr); assert.equal(result.stdout, workflow.stdout); assert.equal(result.stderr, '');
});
for (const id of ['P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P11', 'P12']) await record(`${id}-public-verified-blob`, async () => {
  const memory = await memoryFixture(), fixture = packedData.fixtures.find(item => item.id === id); await installPack(memory, fixture);
  const entry = fixture.entries.at(-1); assert.equal(entry.type, 'blob');
  const tree = await object(memory, 'tree', Buffer.concat([Buffer.from('100644 data\0'), Buffer.from(entry.oid, 'hex')]));
  const commit = await object(memory, 'commit', Buffer.from(`tree ${tree}\nauthor A <a@b> 0 +0000\ncommitter A <a@b> 0 +0000\n\nData\n`));
  await memory.writeFile('/repo/.git/refs/heads/main', Buffer.from(commit + '\n'));
  const chunks = []; const result = await shellFor(memory).exec('git show HEAD:data', { stdout: { async write(bytes) { chunks.push(Buffer.from(bytes)); } } });
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(Buffer.concat(chunks), Buffer.from(entry.bodyBase64, 'base64'));
});
const result = { cases: rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, nativeRuns: 0, privateRuns: 0 };
await fs.writeFile(process.env.PUBLIC_RESULT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ summary: { pass: result.pass, fail: result.fail, cases: rows.length } }));
process.exitCode = result.fail ? 1 : 0;
