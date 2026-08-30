import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { nativeCases, hostCases } from './cases.mjs';
import { env } from './harness.mjs';
const forbiddenHostCalls = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = (...args) => { forbiddenHostCalls.push({ name, args }); throw new Error('Product host execution forbidden'); };
syncBuiltinESMExports();
const { Shell, MemoryFileSystem, agentCommands, FsError, writeText } = await import('../../../src/index.ts');
const fixture = [...nativeCases, ...hostCases].find(row => row.id === process.argv[2]);
assert.ok(fixture);
const fs = new MemoryFileSystem();
for (const path of ['/fixture/work', '/fixture/bin', '/fixture/.roles']) await fs.mkdir(path, { recursive: true });
async function put(path, text, mode = 0o755) { await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true }); await fs.writeFile(path, Buffer.from(text)); await fs.chmod(path, mode); }
for (const [name, entry] of Object.entries(fixture.files ?? {})) await put(`/fixture/${name}`, entry.text, entry.mode);
for (const [name, target] of Object.entries(fixture.links ?? {})) await fs.symlink(target, `/fixture/${name}`);
const shell = new Shell({ fs, cwd: '/fixture', env }).use(agentCommands());
const seen = []; const calls = [];
shell.use((context, next) => { calls.push(context.command); return next(); });
shell.register({ name: 'tick', async execute(context) { seen.push({ args: [...context.args], cwd: context.cwd, env: { ...context.env }, origin: context.stdinIsDefault }); if (fixture.kind === 'output') await writeText(context.stdout, 'abcd', context.signal); return { exitCode: 0 }; } });
shell.register({ name: 'take', async execute(context) { const chunk = await context.stdin[Symbol.asyncIterator]().next(); seen.push({ origin: context.stdinIsDefault, hex: chunk.done ? '' : Buffer.from(chunk.value).toString('hex') }); return { exitCode: 0 }; } });
let observation;
async function execute(script, options = {}) { const result = await shell.exec(script, options); return { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode }; }
async function host() {
  if (fixture.kind === 'vfs') {
    await put('/fixture/script', '/usr/bin/uname > marker\n');
    const result = await execute('./script'); observation.result = result;
    assert.equal(result.status, 127); assert.equal(Buffer.from(await fs.readFile('/fixture/marker')).length, 0); assert.deepEqual(forbiddenHostCalls, []);
  } else if (['commands', 'source', 'depth', 'output'].includes(fixture.kind)) {
    const scripts = { commands: 'tick; tick; tick; tick\n', source: 'tick\n' + ' '.repeat(200), depth: 'tick; ./script\n', output: 'tick; tick; tick; tick\n' };
    await put('/fixture/script', scripts[fixture.kind]);
    const limits = { commands: { maxCommands: 3 }, source: { maxSourceBytes: 270 }, depth: { maxSubstitutionDepth: 2 }, output: { maxOutputBytes: 10 } }[fixture.kind];
    const limit = Object.keys(limits)[0]; let error;
    try { observation.result = await execute(fixture.kind === 'source' ? './script; ./script; tick final' : './script; tick final', { limits }); } catch (caught) { error = caught; observation.error = { name: caught.name, limit: caught.limit, message: caught.message }; }
    assert.equal(error?.limit, limit); assert.ok(seen.length > 0); assert.ok(!seen.some(row => row.args.includes('final')));
    if (fixture.kind === 'commands') assert.equal(seen.length, 2);
    if (fixture.kind === 'source') assert.equal(seen.length, 1);
  } else if (fixture.kind === 'cancel') {
    await put('/fixture/script', 'tick forbidden\n');
    const controller = new AbortController(); const reason = new FsError('ENOENT', { path: '/caller-cancel' }); const original = fs.readFile.bind(fs); let requested = false;
    fs.readFile = async (path, options) => { if (path !== '/fixture/script') return original(path, options); requested = true; setTimeout(() => controller.abort(reason), 5); return new Promise(() => {}); };
    let error; try { await execute('./script; tick final', { signal: controller.signal }); } catch (caught) { error = caught; }
    observation.requested = requested; observation.sameReason = error === reason;
    assert.ok(requested); assert.equal(error, reason); assert.equal(seen.length, 0);
  } else if (fixture.kind === 'cursor' || fixture.kind === 'origin') {
    await put('/fixture/script', 'take\n');
    const modes = fixture.kind === 'cursor' ? ['binary'] : ['default', 'empty'];
    observation.modes = [];
    for (const mode of modes) { seen.length = 0; const options = mode === 'default' ? {} : { stdin: mode === 'empty' ? '' : (async function* () { yield Buffer.from([0, 255]); yield Buffer.from([65]); })() }; const result = await execute('./script; take', options); observation.modes.push({ mode, result, seen: structuredClone(seen) }); assert.equal(result.status, 0); assert.deepEqual(seen, [{ origin: mode === 'default', hex: mode === 'binary' ? '00ff' : '' }, { origin: mode === 'default', hex: mode === 'binary' ? '41' : '' }]); }
  } else if (fixture.kind === 'state') {
    await put('/fixture/script', 'tick "$1" "$PUBLIC" "${SECRET-unset}"; PUBLIC=child; cd work; exit 7\n');
    observation.result = await execute('export PUBLIC=public; SECRET=secret; ./script \'; tick injected\'; tick "$PUBLIC" "$SECRET"');
    assert.equal(observation.result.status, 0); assert.equal(seen.length, 2); assert.deepEqual(seen[0].args, ['; tick injected', 'public', 'unset']); assert.deepEqual(seen[1].args, ['public', 'secret']); assert.equal(seen[1].cwd, '/fixture'); assert.equal(seen[1].env.PUBLIC, 'public'); assert.equal(seen[1].env.SECRET, undefined);
  } else if (fixture.kind === 'permission') {
    await put('/fixture/script', 'tick forbidden; printf forbidden > marker\n', 0o644);
    observation.result = await execute('./script'); assert.equal(observation.result.status, 126); assert.equal(seen.length, 0); await assert.rejects(fs.stat('/fixture/marker'), error => error.code === 'ENOENT');
  }
}
try {
  if (fixture.kind) { observation = { passed: false, seen, calls, forbiddenHostCalls }; try { await host(); assert.equal(forbiddenHostCalls.length, 0); observation.passed = true; } catch (error) { observation.failure = { name: error.name, message: error.message, actual: error.actual, expected: error.expected }; } }
  else {
    observation = await execute(fixture.script); const entries = {};
    async function visit(path) { for (const entry of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) { if (entry.name === '.roles') continue; const child = `${path}/${entry.name}`; const key = child.slice('/fixture/'.length); const stat = await fs.lstat(child); if (stat.type === 'directory') { entries[key + '/'] = null; await visit(child); } else if (stat.type === 'symlink') entries[key] = { link: await fs.readlink(child) }; else { await fs.chmod(child, (stat.mode & 0o777) | 0o400); entries[key] = { bytes: Buffer.from(await fs.readFile(child)).toString('base64'), mode: stat.mode & 0o777 }; } } }
    await visit('/fixture'); observation.entries = entries;
  }
} catch (error) { observation = { thrown: { name: error.name, message: error.message } }; }
finally { await shell.dispose(); }
console.log(JSON.stringify({ observation, calls, forbiddenHostCalls }));
