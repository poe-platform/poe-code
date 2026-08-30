import assert from 'node:assert/strict';
import { nativeCases, hostCases } from './cases.mjs';
import { env } from './harness.mjs';
const { Shell, MemoryFileSystem, agentCommands, FsError, writeText } = await import('../../../src/index.ts');
const fixture = [...nativeCases, ...hostCases].find(row => row.id === process.argv[2]);
assert.ok(fixture);
const observations = [];
async function setup(includePublic = true) {
  const fs = new MemoryFileSystem(); await fs.mkdir('/fixture/work', { recursive: true });
  return { fs, shell: new Shell({ fs, cwd: '/fixture', env: includePublic ? { ...env, PUBLIC: 'public' } : env }).use(agentCommands()) };
}
async function native() {
  const { fs, shell } = await setup(false);
  const actual = await shell.exec(fixture.script.replaceAll('{{BASH}}', 'bash').replaceAll('{{SH}}', 'sh'));
  const files = { 'work/': null };
  for (const directory of ['/fixture', '/fixture/work']) for (const entry of await fs.readdir(directory)) if ((await fs.stat(`${directory}/${entry.name}`)).type === 'file') files[`${directory}/${entry.name}`.slice(9)] = Buffer.from(await fs.readFile(`${directory}/${entry.name}`)).toString('base64');
  await shell.dispose(); return { stdout: Buffer.from(actual.stdoutBytes).toString('base64'), stderr: Buffer.from(actual.stderrBytes).toString('base64'), status: actual.exitCode, files };
}
async function boundary(options, args = [], script = 'SECRET=secret; bridge', execOptions = {}) {
  const { shell } = await setup(); const seen = []; const middleware = []; let parentStable = false;
  shell.use(async (context, next) => { middleware.push(context.command); return next(); });
  shell.register({ name: 'reporter', async execute(context) { seen.push({ env: { ...context.env }, cwd: context.cwd, args: [...context.args], origin: context.stdinIsDefault }); return { exitCode: 0 }; } });
  shell.register({ name: 'bridge', async execute(context) { const before = JSON.stringify({ env: context.env, cwd: context.cwd }); try { return await context.invoke('reporter', args, options); } finally { parentStable = before === JSON.stringify({ env: context.env, cwd: context.cwd }); } } });
  try { const result = await shell.exec(script, execOptions); return { result, seen, middleware, parentStable }; } finally { await shell.dispose(); }
}
async function host() {
  if (fixture.kind === 'merge') {
    for (const options of [{ env: { ONLY: 'value' } }, { env: { ONLY: 'value' }, replaceEnv: false }]) {
      const row = await boundary(options); observations.push(row); assert.equal(row.seen.length, 1); assert.equal(row.seen[0].env.PUBLIC, 'public'); assert.equal(row.seen[0].env.PWD, '/fixture'); assert.equal(row.seen[0].env.ONLY, 'value'); assert.equal(row.seen[0].env.SECRET, undefined); assert.ok(row.parentStable);
    }
  } else if (fixture.kind === 'exact' || fixture.kind === 'empty') {
    const choices = fixture.kind === 'exact' ? [{ replaceEnv: true, env: { ONLY: 'value', PWD: 'datum' }, cwd: '/fixture/work' }] : [{ replaceEnv: true, env: {} }, { replaceEnv: true }];
    for (const options of choices) { const row = await boundary(options); observations.push(row); assert.deepEqual(row.seen[0]?.env, options.env ?? {}); assert.equal(row.seen[0]?.cwd, options.cwd ?? '/fixture'); assert.ok(row.parentStable); }
  } else if (fixture.kind === 'core') {
    for (const [script, expected] of [['PREFIX=gone env -i KEEP=value reporter', { KEEP: 'value' }], ['env -i reporter', {}]]) {
      const row = await boundary({}, [], script); observations.push(row); assert.equal(row.result.exitCode, 0); assert.deepEqual(row.seen[0]?.env, expected);
    }
  } else if (fixture.kind === 'literal') {
    const args = ['', 'a b', '; printf forbidden', '$PUBLIC', '*.txt']; const row = await boundary({ replaceEnv: true, env: { ONLY: 'value' } }, args); observations.push(row);
    assert.equal(row.seen.length, 1); assert.deepEqual(row.seen[0].args, args); assert.deepEqual(row.seen[0].env, { ONLY: 'value' }); assert.equal(row.middleware.filter(name => name === 'reporter').length, 1);
  } else if (fixture.kind === 'stdin') {
    for (const mode of ['default', 'empty', 'binary']) {
      const { shell } = await setup(); const seen = [];
      shell.register({ name: 'take', async execute(context) { const value = await context.stdin[Symbol.asyncIterator]().next(); seen.push({ origin: context.stdinIsDefault, hex: value.done ? '' : Buffer.from(value.value).toString('hex'), env: { ...context.env } }); return { exitCode: 0 }; } });
      shell.register({ name: 'bridge', execute: context => context.invoke('take', [], { replaceEnv: true, env: {} }) });
      const input = mode === 'binary' ? (async function* () { yield Buffer.from([0, 255]); yield Buffer.from([65]); })() : '';
      try { const result = await shell.exec('bridge; take', mode === 'default' ? {} : { stdin: input }); observations.push({ mode, seen, result }); assert.equal(result.exitCode, 0); assert.equal(seen.length, 2); assert.deepEqual(seen.map(row => row.origin), [mode === 'default', mode === 'default']); assert.deepEqual(seen.map(row => row.hex), mode === 'binary' ? ['00ff', '41'] : ['', '']); assert.deepEqual(seen[0].env, {}); } finally { await shell.dispose(); }
    }
  } else if (fixture.kind === 'validation') {
    for (const map of [{ 'BAD=KEY': 'x' }, { ['BAD\0KEY']: 'x' }, { GOOD: 'x\0y' }]) {
      const { shell } = await setup(); let effects = 0; let rejected = false;
      shell.register({ name: 'reporter', execute() { effects++; return { exitCode: 0 }; } });
      shell.register({ name: 'bridge', async execute(context) { try { await context.invoke('reporter', [], { replaceEnv: true, env: map }); } catch { rejected = true; } return { exitCode: 0 }; } });
      try { await shell.exec('bridge'); observations.push({ map, effects, rejected }); assert.ok(rejected); assert.equal(effects, 0); } finally { await shell.dispose(); }
    }
  } else if (fixture.kind === 'parent') {
    for (const status of [0, 7]) {
      const { shell } = await setup(); let stable = false; const calls = [];
      shell.register({ name: 'mutate', execute(context) { calls.push({ ...context.env }); context.env.PUBLIC = 'changed'; context.cwd = '/fixture/work'; return { exitCode: status }; } });
      shell.register({ name: 'bridge', async execute(context) { const before = JSON.stringify({ env: context.env, cwd: context.cwd }); try { return await context.invoke('mutate', [], { replaceEnv: true, env: { KEEP: 'value' } }); } finally { stable = before === JSON.stringify({ env: context.env, cwd: context.cwd }); } } });
      try { const result = await shell.exec('SECRET=outer; export PUBLIC=public; call() { local SECRET=inner; bridge; printf "%s:%s:%s\\n" "$?" "$SECRET" "$PUBLIC"; }; call; printf "%s:%s\\n" "$SECRET" "$PUBLIC"; bash -c \'printf "%s:%s\\n" "${SECRET-unset}" "$PUBLIC"\''); observations.push({ status, calls, stable, result }); assert.equal(result.stdout, `${status}:inner:public\nouter:public\nunset:public\n`); assert.equal(result.stderr, ''); assert.ok(stable); assert.deepEqual(calls, [{ KEEP: 'value' }]); } finally { await shell.dispose(); }
    }
  } else if (fixture.kind === 'cancel') {
    const { shell } = await setup(); const controller = new AbortController(); const reason = new FsError('ENOENT', { path: '/caller-abort' }); let stable = false; let started = false; let received; let marker = 0; let caught;
    shell.register({ name: 'pending', async execute(context) { started = true; received = context.signal; setTimeout(() => controller.abort(reason), 15); await new Promise((resolvePending, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })); return { exitCode: 0 }; } });
    shell.register({ name: 'marker', execute() { marker++; return { exitCode: 0 }; } });
    shell.register({ name: 'bridge', async execute(context) { const before = JSON.stringify(context.env); try { return await context.invoke('pending', [], { replaceEnv: true, env: {} }); } finally { stable = before === JSON.stringify(context.env); } } });
    try { await shell.exec('bridge; marker', { signal: controller.signal }); } catch (error) { caught = error; } finally { await shell.dispose(); }
    await new Promise(resolveWait => setImmediate(resolveWait)); observations.push({ started, stable, marker, exactReason: caught === reason, signalAborted: received?.aborted }); assert.ok(started && stable && received?.aborted); assert.equal(marker, 0); assert.equal(caught, reason);
  } else if (fixture.kind === 'budgets') {
    for (const [limit, value] of [['maxCommands', 4], ['maxOutputBytes', 10], ['maxSubstitutionDepth', 3], ['maxSourceBytes', 35], ['maxLoopIterations', 3]]) {
      const { shell } = await setup(); let calls = 0; let caught; let output = '';
      shell.register({ name: 'tick', async execute(context) { calls++; if (limit === 'maxOutputBytes') await writeText(context.stdout, '1234'); if (limit === 'maxSourceBytes') return context.invoke('bash', ['-c', ':; '.repeat(20)], { replaceEnv: true }); if (limit === 'maxLoopIterations') { await context.invoke('bash', ['-c', 'for item in a b; do :; done'], { replaceEnv: true }); return context.invoke('bash', ['-c', 'for item in c d; do :; done'], { replaceEnv: true }); } return context.invoke('tick', [], { replaceEnv: true }); } });
      try { await shell.exec('env -i tick', { limits: { [limit]: value }, stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } } }); } catch (error) { caught = error; } finally { await shell.dispose(); }
      observations.push({ limit, calls, output, error: caught?.message, actualLimit: caught?.limit, passed: caught?.name === 'ShellLimitError' && caught?.limit === limit && calls > 0 && (limit !== 'maxOutputBytes' || calls === 3 && output === '12341234') });
    }
    assert.ok(observations.every(row => row.passed), 'All five budget witnesses must pass');
  }
  return { passed: true, observations };
}
try { console.log(JSON.stringify({ id: fixture.id, observation: fixture.kind ? await host() : await native() })); }
catch (error) { console.log(JSON.stringify({ id: fixture.id, observation: { passed: false, observations, error: { name: error.name, message: error.message, actual: error.actual, expected: error.expected } } })); }
