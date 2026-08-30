import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from 'virtual-bash';
import * as leaf from 'virtual-bash/commands/apply-patch';
import { expectedNames } from './names.mjs';

const rows = [], shells = new Set();
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const add = (name = 'note', text = 'hello') => `*** Begin Patch\n*** Add File: ${name}\n+${text}\n*** End Patch\n`;
const update = (name = 'note') => `*** Begin Patch\n*** Update File: ${name}\n@@\n-old\n+new\n*** End Patch\n`;
const summary = label => `Success. Updated the following files:\n${label}\n`;
const text = async (filesystem, name) => Buffer.from(await filesystem.readFile(name)).toString();
const absent = async (filesystem, name) => assert.rejects(filesystem.lstat(name), error => error.code === 'ENOENT');
const host = commands => ({ commands, use() { throw Error('unexpected middleware'); }, registerFileSystem() { throw Error('unexpected filesystem'); } });
async function fixture(options = {}, filesystem = new api.MemoryFileSystem(), cwd = '/w') {
  await filesystem.mkdir(cwd, { recursive: true });
  const shell = new api.Shell({ fs: filesystem, cwd }).use(api.agentCommands(options)); shells.add(shell);
  return { shell, filesystem };
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
  rows.push(row); console.log(JSON.stringify(row));
  if (row.cleanupFailure) process.exit(78);
}
await record('P01-public-exports', async () => {
  for (const name of ['createApplyPatchCommand', 'createApplyPatchCommands', 'applyPatchCommands']) assert.equal(api[name], leaf[name]);
  assert.equal(api.createApplyPatchCommand().name, 'apply_patch');
  assert.deepEqual(api.createApplyPatchCommands().map(command => command.name), ['apply_patch']);
  const root = await fs.realpath(process.env.PRODUCT_ROOT);
  assert.equal(await fs.realpath(fileURLToPath(import.meta.resolve('virtual-bash'))), path.join(root, 'dist/index.js'));
  assert.equal(await fs.realpath(fileURLToPath(import.meta.resolve('virtual-bash/commands/apply-patch'))), path.join(root, 'dist/commands/apply-patch/index.js'));
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.deepEqual(metadata.exports['./commands/apply-patch'], { types: './dist/commands/apply-patch/index.d.ts', import: './dist/commands/apply-patch/index.js' });
});
await record('P02-exact79', async () => {
  assert.equal(expectedNames.length, 79); assert.equal(new Set(expectedNames).size, 79);
  const names = api.createAgentCommands().map(command => command.name).sort(); assert.deepEqual(names, expectedNames);
  for (const name of ['curl', 'safejs', 'git', 'node', 'npm', 'npx', 'yq', 'xan', 'getopts']) assert.ok(!names.includes(name));
  const { shell } = await fixture(); await shell.exec('true'); assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expectedNames);
});
await record('P03-standalone', async () => {
  const filesystem = new api.MemoryFileSystem(); const shell = new api.Shell({ fs: filesystem }).use(api.applyPatchCommands()); shells.add(shell);
  const result = await shell.exec('apply_patch', { stdin: add() }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('A note')); assert.equal(await text(filesystem, '/note'), 'hello\n'); assert.equal(shell.commands.list().length, 1);
});
await record('P04-collision-global-false', () => {
  const sentinel = { name: 'apply_patch', execute: () => ({ exitCode: 19 }) }, commands = new api.CommandRegistry([sentinel]);
  assert.throws(() => api.agentCommands({ applyPatch: { replace: true } }).setup(host(commands)), /already registered/); assert.deepEqual(commands.list(), [sentinel]);
});
await record('P05-replace-global-true', () => {
  const sentinel = { name: 'apply_patch', execute: () => ({ exitCode: 19 }) }, custom = { name: 'custom', execute: () => ({ exitCode: 17 }) }, commands = new api.CommandRegistry([sentinel, custom]);
  api.agentCommands({ replace: true, applyPatch: { replace: false } }).setup(host(commands)); assert.equal(commands.list().length, 80); assert.notEqual(commands.get('apply_patch'), sentinel); assert.equal(commands.get('custom'), custom);
});
await record('P06-invalid-options-atomic', () => {
  const commands = new api.CommandRegistry(); assert.throws(() => api.agentCommands({ applyPatch: { limits: { maxFiles: 0 } } }).setup(host(commands)), RangeError); assert.equal(commands.list().length, 0);
  assert.throws(() => api.createApplyPatchCommand({ limits: { maxFiles: 257 } }), RangeError);
  assert.throws(() => api.createApplyPatchCommand({ limits: { unexpected: 1 } }), TypeError);
});
await record('P07-forwarded-limit', async () => {
  const { shell, filesystem } = await fixture({ applyPatch: { limits: { maxPatchBytes: 8 } } });
  const result = await shell.exec('apply_patch', { stdin: add() }); assert.equal(result.exitCode, 1); assert.match(result.stderr, /maxPatchBytes/); assert.equal(result.stdout, ''); await absent(filesystem, '/w/note');
});
await record('P08-literal-argument', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('apply_patch ' + quote(add('space name', 'hé😀'))); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('A space name')); assert.equal(result.stderr, ''); assert.equal(await text(filesystem, '/w/space name'), 'hé😀\n');
});
await record('P09-heredoc-input', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('apply_patch <<\'PATCH\'\n' + add() + 'PATCH\n'); assert.equal(result.exitCode, 0); assert.equal(await text(filesystem, '/w/note'), 'hello\n');
});
await record('P10-update', async () => {
  const { shell, filesystem } = await fixture(); await filesystem.writeFile('/w/note', Buffer.from('old\n')); const result = await shell.exec('apply_patch', { stdin: update() }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('M note')); assert.equal(await text(filesystem, '/w/note'), 'new\n');
});
await record('P11-move', async () => {
  const { shell, filesystem } = await fixture(); await filesystem.writeFile('/w/note', Buffer.from('old\n')); const patch = update().replace('*** Update File: note\n', '*** Update File: note\n*** Move to: folder/new\n'); const result = await shell.exec('apply_patch', { stdin: patch }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('M folder/new')); await absent(filesystem, '/w/note'); assert.equal(await text(filesystem, '/w/folder/new'), 'new\n');
});
await record('P12-delete', async () => {
  const { shell, filesystem } = await fixture(); await filesystem.writeFile('/w/note', Buffer.from('old\n')); const result = await shell.exec('apply_patch', { stdin: '*** Begin Patch\n*** Delete File: note\n*** End Patch\n' }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('D note')); await absent(filesystem, '/w/note');
});
await record('P13-staging-before-publication', async () => {
  const { shell, filesystem } = await fixture(); const patch = add().replace('*** End Patch\n', '*** Update File: missing\n@@\n-old\n+new\n*** End Patch\n'); const result = await shell.exec('apply_patch', { stdin: patch }); assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /missing target/); await absent(filesystem, '/w/note');
});
await record('P14-readonly', async () => {
  const memory = new api.MemoryFileSystem(); await memory.mkdir('/w'); await memory.writeFile('/w/note', Buffer.from('old\n')); const shell = new api.Shell({ fs: api.createReadOnlyFileSystem(memory), cwd: '/w' }).use(api.agentCommands()); shells.add(shell); const result = await shell.exec('apply_patch', { stdin: update() }); assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /read-only/); assert.equal(await text(memory, '/w/note'), 'old\n');
});
await record('P15-mount', async () => {
  const root = new api.MemoryFileSystem(), child = new api.MemoryFileSystem(); await root.mkdir('/mounted'); const mount = api.createMountFileSystem({ root, mounts: { '/mounted': child } });
  const shell = new api.Shell({ fs: mount, cwd: '/mounted' }).use(api.agentCommands()); shells.add(shell); const result = await shell.exec('apply_patch', { stdin: add() }); assert.equal(result.exitCode, 0); assert.equal(await text(child, '/note'), 'hello\n'); await absent(root, '/mounted/note');
});
await record('P16-symlink-refusal', async () => {
  const { shell, filesystem } = await fixture(); await filesystem.writeFile('/w/target', Buffer.from('old\n')); await filesystem.symlink('/w/target', '/w/note'); const result = await shell.exec('apply_patch', { stdin: update() }); assert.equal(result.exitCode, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /symlink/); assert.equal(await text(filesystem, '/w/target'), 'old\n');
});
await record('P17-traversal-refusal', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('apply_patch', { stdin: add('../outside') }); assert.equal(result.exitCode, 2); assert.match(result.stderr, /parent traversal/); assert.equal(result.stdout, ''); await absent(filesystem, '/outside');
});
await record('P18-invalid-encoding', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('apply_patch', { stdin: Uint8Array.of(255) }); assert.equal(result.exitCode, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /UTF-8/); await absent(filesystem, '/w/note');
});
await record('P19-pipeline', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec("printf '%s' " + quote(add()) + ' | apply_patch | head -n 1'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'Success. Updated the following files:\n'); assert.equal(await text(filesystem, '/w/note'), 'hello\n');
});
await record('P20-array-arguments', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('patches=(' + quote(add()) + '); apply_patch "${patches[@]}"; printf "%s\\n" "${#patches[@]}"'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('A note') + '1\n'); assert.equal(await text(filesystem, '/w/note'), 'hello\n');
});
await record('P21-local-array-scope', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('args=(outer); f(){ local args; args=(' + quote(add()) + '); apply_patch "${args[@]}"; }; f; printf "%s\\n" "${args[0]}"'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, summary('A note') + 'outer\n'); assert.equal(await text(filesystem, '/w/note'), 'hello\n');
});
await record('P22-borrowed-input', async () => {
  const { shell, filesystem } = await fixture(); const bytes = Buffer.from(add('note', '😀')); let returned = false;
  const input = (async function* () { try { const reused = Buffer.alloc(1); for (const byte of bytes) { reused[0] = byte; yield reused; } reused[0] = 0; } finally { returned = true; } })();
  const result = await shell.exec('apply_patch', { stdin: input }); assert.equal(result.exitCode, 0); assert.equal(await text(filesystem, '/w/note'), '😀\n'); assert.equal(returned, true);
});
await record('P23-preabort-identity', async () => {
  const { shell, filesystem } = await fixture(); const controller = new AbortController(), reason = Object.freeze({ caller: 'before' }); controller.abort(reason); await assert.rejects(shell.exec('apply_patch', { stdin: add(), signal: controller.signal }), error => error === reason); await absent(filesystem, '/w/note');
});
await record('P24-required-stderr', async () => {
  const { shell } = await fixture(); let writes = 0; const result = await shell.exec('apply_patch', { stdin: 'bad', stdout: { async write() { writes++; throw Error('must not write stdout'); } } }); assert.equal(result.exitCode, 2); assert.equal(writes, 0); assert.match(result.stderr, /^apply_patch:/); assert.equal(result.stdout, '');
});
await record('P25-output-failure-after-publication', async () => {
  const { shell, filesystem } = await fixture(); const result = await shell.exec('apply_patch', { stdin: add(), stdout: { async write() { throw new Error('public sink failure'); } } }); assert.equal(result.exitCode, 1); assert.match(result.stderr, /public sink failure/); assert.equal(await text(filesystem, '/w/note'), 'hello\n');
});
await record('P26-registered-cleanups-idempotent', async () => {
  const filesystem = new api.MemoryFileSystem(), callbacks = [], chunks = []; let closes = 0, settled = false;
  const context = { command: 'apply_patch', args: [add()], cwd: '/', env: {}, fs: filesystem, signal: new AbortController().signal, stdin: api.toByteSource(''), stdout: { async write(bytes) { chunks.push(Buffer.from(bytes)); } }, stderr: { async write() { throw Error('unexpected diagnostic'); } }, registerCleanup(fn) { callbacks.push(fn); } };
  const result = await api.createApplyPatchCommand().execute(context); settled = true;
  assert.equal(result.exitCode, 0); assert.equal(callbacks.length, 2);
  for (const fn of callbacks) { await fn(); closes++; } for (const fn of callbacks) await fn();
  assert.equal(closes, 2); assert.equal(settled, true); assert.equal(Buffer.concat(chunks).toString(), summary('A note')); assert.equal(await text(filesystem, '/note'), 'hello\n');
});
await record('P27-caller-abort-after-publication', async () => {
  const { shell, filesystem } = await fixture(); const controller = new AbortController(), reason = Object.freeze({ caller: 'after-publication' });
  await assert.rejects(shell.exec('apply_patch', { stdin: add(), signal: controller.signal, stdout: { async write() { controller.abort(reason); throw new Error('secondary sink error'); } } }), error => error === reason);
  assert.equal(await text(filesystem, '/w/note'), 'hello\n');
});
await record('P28-awaited-output', async () => {
  const { shell, filesystem } = await fixture(); let enter, release, settled = false;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const execution = shell.exec('apply_patch', { stdin: add(), stdout: { async write() { enter(); await gate; } } });
  execution.then(() => { settled = true; }, () => { settled = true; });
  try { await entered; await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); assert.equal(await text(filesystem, '/w/note'), 'hello\n'); }
  finally { release(); }
  assert.equal((await execution).exitCode, 0);
});
const result = { cases: rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, nativeRuns: 0, privateRuns: 0 };
await fs.writeFile(process.env.PUBLIC_RESULT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ summary: { pass: result.pass, fail: result.fail, cases: rows.length } }));
process.exitCode = result.fail ? 1 : 0;
