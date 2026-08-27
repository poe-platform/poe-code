import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const snapshot = resolve(owned, '.temporary/runtime-r1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (!process.send) {
  const freeze = JSON.parse(await readFile(resolve(owned, 'evidence/runtime-r1-freeze.json')));
  const build = JSON.parse(await readFile(resolve(owned, 'evidence/runtime-r1-build.json')));
  assert.equal(freeze.commit, '1b133a8662a32ee84524794842074c9c98d5f6c3');
  assert.equal(freeze.mode, 'runtime-handoff');
  assert.equal(build.status, 0);
  for (const entry of [...freeze.identities, ...build.emitted]) assert.equal(hash(await readFile(resolve(snapshot, entry.path))), entry.sha256, entry.path);
  const observer = resolve(owned, 'runtime-r1-observer.mjs');
  const result = await new Promise(resolveResult => {
    const child = fork(fileURLToPath(import.meta.url), [snapshot], { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', observer], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } });
    const state = { pid: child.pid, stdout: '', stderr: '', events: [], result: null, killed: false };
    let bytes = 0;
    const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
    const timer = setTimeout(() => kill('exact child watchdog'), 20000);
    child.on('message', message => {
      if (Buffer.byteLength(JSON.stringify(message)) > 1048576) return kill('IPC cap');
      if (message.kind !== 'result') return kill('unexpected IPC');
      state.result = message;
    });
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) kill('output cap'); else state[name] += chunk; });
      stream.on('close', () => state.events.push(`${name}-close`));
    }
    child.on('error', error => { state.spawnError = String(error); });
    child.on('disconnect', () => state.events.push('disconnect'));
    child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ ...state, code, signal }); });
  });
  const record = { source: freeze.commit, time: new Date().toISOString(), harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), observerSha256: hash(await readFile(observer)), bounds: { watchdogMs: 20000, heapMb: 128, consoleBytes: 65536, ipcBytes: 1048576, strictUnhandled: true }, ...result, scope: 'additive independent contract triage; prepared runtime.mjs and all old assertion bodies unchanged', riskConsumed: 0 };
  await writeFile(resolve(owned, 'evidence/runtime-r1-triage.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ pass: result.result?.pass, counts: result.result?.counts, code: result.code, killed: result.killed }));
  if (result.code !== 0 || result.killed || !result.result?.pass) process.exitCode = 1;
} else {
  const api = await import(pathToFileURL(resolve(snapshot, 'dist/index.js')));
  const observations = [];
  const gates = [];
  const shells = [];
  const tasks = [];
  const tick = () => new Promise(resolveTick => setImmediate(resolveTick));
  const deferred = () => {
    let release;
    const promise = new Promise(resolvePromise => { release = resolvePromise; });
    const gate = { promise, release };
    gates.push(gate);
    return gate;
  };
  const settle = promise => Promise.resolve(promise).then(value => ({ resolved: true, value }), error => ({ resolved: false, error }));
  const track = promise => { const task = settle(promise); tasks.push(task); return task; };
  const createShell = () => { const shell = new api.Shell({ fs: new api.MemoryFileSystem() }); shells.push(shell); return shell; };
  async function within(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((unused, reject) => { timer = setTimeout(() => reject(new Error('bounded triage timeout')), 1200); })]); }
    finally { clearTimeout(timer); }
  }
  async function pending(promise) {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await tick();
    assert.equal(settled, false);
  }
  async function check(name, callback) {
    const firstShell = shells.length;
    const firstTask = tasks.length;
    const observation = { name, pass: false };
    try { observation.details = await callback(); observation.pass = true; }
    catch (error) { observation.error = error.stack; }
    finally {
      for (const gate of gates) gate.release();
      try { await within(Promise.all(shells.slice(firstShell).map(shell => settle(shell.dispose())))); await within(Promise.all(tasks.slice(firstTask))); }
      catch (error) { observation.cleanupError = error.stack; observation.pass = false; }
      observations.push(observation);
    }
  }
  await check('triage:ordinary-command-throw-selects-diagnostic-result', async () => {
    const shell = createShell();
    let cleaned = 0;
    shell.register({ name: 'owned', execute(context) { context.registerCleanup(() => { cleaned++; }); throw new Error('selected execution failure'); } });
    const result = await within(shell.exec('owned'));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'shell: line 1: selected execution failure\n');
    assert.equal(cleaned, 1);
    return { exitCode: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), cleaned };
  });
  for (const primaryKind of ['ordinary-command-result', 'selected-ShellLimitError-rejection']) {
    for (const caller of ['none', 0, false, '', { code: 'ENOENT' }]) {
      await check(`triage:${primaryKind}:caller-${JSON.stringify(caller)}`, async () => {
        const shell = createShell();
        const controller = new AbortController();
        const primary = primaryKind === 'ordinary-command-result' ? new Error('selected execution failure') : new api.ShellLimitError('maxCommands');
        const primaryKeys = Object.keys(primary);
        const failures = [new Error('secondary cleanup failure'), new Error('other secondary cleanup failure')];
        const entered = deferred();
        const gate = deferred();
        let cleanups = 0;
        let stderr = '';
        shell.register({ name: 'owned', execute(context) {
          context.registerCleanup(async () => { cleanups++; entered.release(); await gate.promise; throw failures[0]; });
          context.registerCleanup(() => { cleanups++; throw failures[1]; });
          throw primary;
        } });
        const running = track(shell.exec('owned', { signal: controller.signal, stderr: { async write(bytes) { stderr += Buffer.from(bytes); } } }));
        await within(entered.promise);
        if (caller !== 'none') controller.abort(caller);
        await pending(running);
        assert.equal(cleanups, 2);
        gate.release();
        const result = await within(running);
        assert.equal(result.resolved, false);
        if (caller !== 'none') assert.equal(result.error, caller);
        else if (primaryKind === 'selected-ShellLimitError-rejection') assert.equal(result.error, primary);
        else {
          assert.ok(result.error instanceof AggregateError);
          assert.deepEqual(new Set(result.error.errors), new Set(failures));
          assert.equal(stderr, 'shell: line 1: selected execution failure\n');
        }
        assert.deepEqual(Object.keys(primary), primaryKeys);
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
        return { caller, primaryKind, exactCaller: caller === 'none' ? null : result.error === caller, exactPrimary: result.error === primary, errorType: result.error?.constructor?.name ?? typeof result.error, errorCode: result.error?.code, cleanupFailures: result.error instanceof AggregateError ? result.error.errors.map(error => error.message) : undefined, cleanups, stderr: Buffer.from(stderr).toString('base64'), abortListeners: 0 };
      });
    }
  }
  await check('R1:queued-plugin-setup-disposal-retires-accepted-lease', async () => {
    const shell = createShell();
    const events = [];
    let lease = false;
    shell.use({ name: 'queued', setup(host) { events.push('setup'); lease = true; host.use((context, next) => next()); events.push('installed'); }, dispose() { events.push('dispose'); lease = false; } });
    await within(shell.dispose());
    assert.equal(lease, false);
    assert.deepEqual(events, ['setup', 'installed', 'dispose']);
    return { events, leaseAtDisposal: lease };
  });
  await check('R1:admitted-async-setup-drains-without-external-reopening', async () => {
    const shell = createShell();
    const entered = deferred();
    const gate = deferred();
    const fs = new api.MemoryFileSystem();
    let lease = false;
    let installed = false;
    shell.use({ name: 'held', async setup(host) { lease = true; entered.release(); await gate.promise; host.use((context, next) => next()); host.registerFileSystem('held', () => fs); installed = true; }, dispose() { lease = false; } });
    const first = track(shell.dispose());
    const second = track(shell.dispose());
    await within(entered.promise);
    assert.throws(() => shell.use((context, next) => next()), /disposed/u);
    assert.throws(() => shell.registerFileSystem('external', () => fs), /disposed/u);
    assert.equal((await within(track(shell.exec('true')))).resolved, false);
    await pending(first);
    await pending(second);
    assert.equal(lease, true);
    gate.release();
    assert.equal((await within(first)).resolved, true);
    assert.equal((await within(second)).resolved, true);
    assert.equal(lease, false);
    assert.equal(installed, true);
    return { installed, leaseAtDisposal: lease, externalAdmission: false };
  });
  process.send({ kind: 'result', pass: observations.every(observation => observation.pass), counts: { controls: observations.length, passed: observations.filter(observation => observation.pass).length, failed: observations.filter(observation => !observation.pass).length }, observations, riskConsumed: 0 }, () => process.disconnect());
}
