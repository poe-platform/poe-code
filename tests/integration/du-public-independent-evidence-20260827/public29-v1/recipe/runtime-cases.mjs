import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import { assertDefaultNames } from './binding-contract.mjs';

export function exact(result, expected) {
  assert.equal(result.exitCode, expected.exitCode);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
  if (result.stdoutBytes) assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(expected.stdout));
  if (result.stderrBytes) assert.deepEqual(result.stderrBytes, new TextEncoder().encode(expected.stderr));
}
function deferred() { let resolve, reject; const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; }); return { promise, resolve, reject }; }
function view(filesystem, overrides) {
  return new Proxy(filesystem, { get(target, property) { const value = Object.hasOwn(overrides, property) ? overrides[property] : Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
}
function owned(signal, write = async () => { throw new Error('unexpected output write'); }) {
  return { async write() { throw new Error('unaccounted output fallback'); }, ownedOutput: { consumerClosed: signal, write } };
}
function fixture(api, overrides = {}) {
  const cleanup = [], stdout = [], stderr = [];
  const value = { command: 'du', args: ['-b', '/payload'], cwd: '/', env: {}, fs: new api.MemoryFileSystem(), signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error('DU stdin acquisition forbidden'); } },
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(callback) { cleanup.push(callback); }, ...overrides };
  return { value, cleanup, stdout, stderr, async close() { await Promise.all(cleanup.map(callback => callback())); } };
}
const text = chunks => Buffer.concat(chunks).toString();
async function memory(api, files) {
  const filesystem = new api.MemoryFileSystem();
  for (const [path, value] of Object.entries(files)) {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (parent !== '/') await filesystem.mkdir(parent, { recursive: true });
    await filesystem.writeFile(path, Buffer.from(value));
  }
  return filesystem;
}
async function shellCase(api, filesystem, options, action) {
  const shell = new api.Shell({ fs: filesystem, env: {}, cwd: '/' }).use(api.agentCommands(options));
  try { return await action(shell); } finally { await shell.dispose(); }
}

export async function runExtra(id, api, bindings, r07) {
  if (id === 'R03') {
    const names = bindings.required.approved75Inventory.names;
    const vectors = [names.slice(0, 74), [...names, 'unapproved-command'], [...names.slice(0, 74), names[0]], [...names.slice(0, 74), 'unapproved-command']];
    for (const vector of vectors) assert.throws(() => assertDefaultNames(vector, names));
    return { expectedRejections: 4, productCohorts: 0 };
  }
  if (id === 'R06') {
    const filesystem = await memory(api, { '/usage/a': 'a' });
    const standalone = new api.Shell({ fs: filesystem }).use(api.duCommands());
    try { exact(await standalone.exec('du -bs /usage'), { exitCode: 0, stdout: '1\t/usage\n', stderr: '' }); }
    finally { await standalone.dispose(); }
    await shellCase(api, filesystem, { du: { limits: { maxEntries: 1 } } }, async shell => exact(await shell.exec('du -bs /usage'), bindings.required.diagnostics.entryLimit));
    const sentinel = { name: 'du', execute: () => ({ exitCode: 71 }) };
    const collision = new api.Shell({ fs: filesystem }); collision.register(sentinel); collision.use(api.agentCommands({ du: { replace: true } }));
    try { await assert.rejects(collision.exec(':'), { message: 'Command already registered: du' }); assert.equal(collision.commands.get('du').execute, sentinel.execute); }
    finally { await collision.dispose(); }
    const replaced = new api.Shell({ fs: filesystem }); replaced.register(sentinel); replaced.use(api.agentCommands({ replace: true, du: { replace: false } }));
    try { exact(await replaced.exec('du -bs /usage'), { exitCode: 0, stdout: '1\t/usage\n', stderr: '' }); assert.notEqual(replaced.commands.get('du').execute, sentinel.execute); }
    finally { await replaced.dispose(); }
    return { twoEntryLimitActivated: true, topLevelReplaceAuthoritativeEvenForUntypedNestedOptions: true };
  }
  if (id === 'R07') {
    const filesystem = await memory(api, r07.files);
    for (const path of ['/payload', '/usage/a', '/usage/sub/b']) assert.equal((await filesystem.lstat(path)).allocatedBytes, undefined);
    await shellCase(api, filesystem, {}, async shell => {
      exact(await shell.exec(r07.htmlPositive.command), r07.htmlPositive);
      exact(await shell.exec(r07.duPositive.command), r07.duPositive);
      exact(await shell.exec(r07.duTwoInvocations.command), r07.duTwoInvocations);
    });
    await shellCase(api, filesystem, r07.htmlTight.options, async shell => {
      exact(await shell.exec(r07.htmlTight.command), r07.htmlTight);
      exact(await shell.exec(r07.duPositive.command), r07.duPositive);
      exact(await shell.exec(r07.duTwoInvocations.command), r07.duTwoInvocations);
    });
    await shellCase(api, filesystem, r07.duTight.options, async shell => {
      exact(await shell.exec(r07.duTight.command), r07.duTight);
      exact(await shell.exec(r07.htmlPositive.command), r07.htmlPositive);
      exact(await shell.exec(r07.duTwoInvocations.command), r07.duTwoInvocations);
    });
    return { baselines: 3, htmlTightObservations: 3, duTightObservations: 3, rootSelectedFamily: 'htmlToMarkdown', counterfactual: r07.counterfactual };
  }
  if (id === 'L01' || id === 'L02') {
    const count = id === 'L01' ? 0 : 1;
    const filesystem = await memory(api, { '/usage/a': '123', '/usage/b': '4567' });
    const admitted = deferred(), caller = new AbortController(); let active = 0, calls = 0, retired = 0, callerSignal, operationSignal;
    const wrapped = view(filesystem, { async lstat(path, options) {
      if (path !== (count ? '/usage/b' : '/usage')) return filesystem.lstat(path, options);
      calls++; active++; operationSignal = options.signal; admitted.resolve();
      return new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { active--; retired++; reject(options.signal.reason); }, { once: true }); });
    } });
    const shell = new api.Shell({ fs: wrapped }).use(api.agentCommands());
    shell.use(async (context, next) => { if (context.command === 'du') callerSignal = context.signal; return next(); });
    await shell.exec(':');
    const head = api.createAgentCommands().find(command => command.name === 'head');
    shell.register({ name: 'head', async execute(context) { await admitted.promise; return head.execute(context); } }, { replace: true });
    try {
      exact(await shell.exec(`du -ab /usage | head -n${count}`, { signal: caller.signal }), { exitCode: 0, stdout: count ? '3\t/usage/a\n' : '', stderr: '' });
      assert.deepEqual({ active, calls, retired }, { active: 0, calls: 1, retired: 1 });
      assert.notEqual(operationSignal, callerSignal); assert.equal(caller.signal.aborted, false);
    } finally { await shell.dispose(); }
    return { downstreamRecords: count, admitted: calls, retired, active, callerAborted: caller.signal.aborted, naturalPipelineSettlement: true };
  }
  if (id === 'L03') {
    const caller = new AbortController(), closed = new AbortController(); closed.abort(new api.FsError('EPIPE'));
    let admitted = 0;
    const invalid = fixture(api, { args: ['--not-a-du-option'], signal: caller.signal, stdout: owned(closed.signal), fs: view(new api.MemoryFileSystem(), { async lstat() { admitted++; throw new Error('unexpected admission'); } }) });
    try { const result = await api.createDuCommand().execute(invalid.value); exact({ ...result, stdout: text(invalid.stdout), stderr: text(invalid.stderr) }, bindings.required.diagnostics.invalidOption); assert.equal(admitted, 0); }
    finally { await invalid.close(); }
    const started = deferred(), release = deferred(), outputClosed = new AbortController(); let settled = false;
    const pending = fixture(api, { signal: caller.signal, stdout: owned(outputClosed.signal), fs: view(new api.MemoryFileSystem(), { async lstat() { throw new Error('DU lifecycle provider failure'); } }), stderr: { async write(bytes) { pending.stderr.push(new Uint8Array(bytes)); started.resolve(); await release.promise; } } });
    const execution = Promise.resolve(api.createDuCommand().execute(pending.value)).then(value => { settled = true; return value; }); void execution.catch(() => {});
    try { await started.promise; outputClosed.abort(new api.FsError('EPIPE')); await turn(); assert.equal(settled, false); assert.equal(caller.signal.aborted, false); release.resolve(); assert.equal((await execution).exitCode, 1); assert.equal(text(pending.stderr), 'du: "/payload": DU lifecycle provider failure\n'); }
    finally { release.resolve(); await pending.close(); }
    const filesystem = await memory(api, { '/payload': '1234567' });
    await shellCase(api, filesystem, {}, async shell => { exact(await shell.exec('du -b /payload > /usage.txt | head -n0'), { exitCode: 0, stdout: '', stderr: '' }); assert.equal(Buffer.from(await filesystem.readFile('/usage.txt')).toString(), '7\t/payload\n'); });
    return { invalidOptionAdmission: admitted, requiredStderrAwaited: true, fileDestinationSurvived: true, callerAborted: caller.signal.aborted };
  }
  if (id === 'L04') {
    const filesystem = await memory(api, { '/payload': '1234567' });
    const caller = new AbortController(), closed = new AbortController(); let signal, writes = 0, registrationsAtAdmission;
    const output = [];
    const context = fixture(api, { signal: caller.signal, stdout: owned(closed.signal, async bytes => { writes++; output.push(new Uint8Array(bytes)); }), fs: view(filesystem, { async lstat(path, options) { registrationsAtAdmission = context.cleanup.length; assert.ok(registrationsAtAdmission >= 2); signal = options.signal; return filesystem.lstat(path, options); } }) });
    try { assert.equal((await api.createDuCommand().execute(context.value)).exitCode, 0); assert.equal(writes, 1); assert.equal(text(output), '7\t/payload\n'); assert.notEqual(signal, caller.signal); }
    finally { await context.close(); await context.close(); }
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0); assert.equal(getEventListeners(closed.signal, 'abort').length, 0);
    const preclosed = new AbortController(), reason = new api.FsError('EPIPE'); preclosed.abort(reason); let forbiddenAdmission = 0;
    const negative = fixture(api, { signal: caller.signal, stdout: owned(preclosed.signal), fs: view(filesystem, { async lstat() { forbiddenAdmission++; throw new Error('admission after closure'); } }) });
    try { await assert.rejects(Promise.resolve(api.createDuCommand().execute(negative.value)), error => error === reason); assert.equal(forbiddenAdmission, 0); assert.equal(negative.stderr.length, 0); }
    finally { await negative.close(); }
    return { registrationsAtAdmission, forbiddenAdmission, idempotentCloseAwaited: true, listenersRemaining: 0 };
  }
  if (id === 'L05') {
    const filesystem = await memory(api, { '/payload': '1234567' });
    const started = deferred(), release = deferred(), closed = new AbortController(); let writes = 0, settled = false; const chunks = [];
    const context = fixture(api, { fs: filesystem, stdout: owned(closed.signal, async bytes => { writes++; chunks.push(new Uint8Array(bytes)); started.resolve(); await release.promise; }) });
    const execution = Promise.resolve(api.createDuCommand().execute(context.value)).then(value => { settled = true; return value; }); void execution.catch(() => {});
    try { await started.promise; await turn(); assert.equal(settled, false); assert.equal(writes, 1); release.resolve(); assert.equal((await execution).exitCode, 0); assert.equal(text(chunks), '7\t/payload\n'); }
    finally { release.resolve(); await context.close(); }
    for (const limit of [11, 1]) {
      const output = [], boundary = fixture(api, { fs: filesystem, args: ['-b', '/payload', '/missing'], stdout: owned(new AbortController().signal, async bytes => output.push(new Uint8Array(bytes))) });
      try { assert.equal((await api.createDuCommand({ limits: { maxOutputBytes: limit } }).execute(boundary.value)).exitCode, 1); assert.equal(text(output), limit === 11 ? '7\t/payload\n' : ''); assert.equal(boundary.stderr.length, 0); }
      finally { await boundary.close(); }
    }
    return { awaitedWrites: writes, ownedCopies: true, combinedBudgetLimits: [11, 1], requiredDiagnosticCannotResetBudget: true };
  }
  if (id === 'L06') {
    const filesystem = await memory(api, { '/payload': '1234567' });
    const entered = deferred(), release = deferred(); let registered = false, active = 0, released = 0, settled = false, draining;
    const cleanup = () => draining ??= (async () => { entered.resolve(); await release.promise; active--; released++; })();
    const shell = new api.Shell({ fs: view(filesystem, { async lstat(path, options) { assert.equal(registered, true); active++; return filesystem.lstat(path, options); } }) }).use(api.agentCommands());
    shell.use(async (context, next) => { if (context.command === 'du') { context.registerCleanup(cleanup); registered = true; } return next(); });
    const execution = shell.exec('du -b /payload', { stdout: owned(new AbortController().signal, async () => {}) }).then(value => { settled = true; return value; }); void execution.catch(() => {});
    try { await entered.promise; await turn(); assert.equal(settled, false); assert.equal(active, 1); release.resolve(); exact(await execution, { exitCode: 0, stdout: '7\t/payload\n', stderr: '' }); assert.deepEqual({ active, released }, { active: 0, released: 1 }); }
    finally { release.resolve(); await shell.dispose(); }
    assert.equal(released, 1);
    return { providerOwnershipExplicitlyRegistered: true, execAwaitedRelease: true, active, releases: released, hiddenOpaqueLeaseClaim: false };
  }
  if (id === 'L07') {
    const outcomes = [];
    for (const cleanupFails of [false, true]) {
      const caller = new AbortController(), admitted = deferred(), cleanupEntered = deferred(), release = deferred();
      const reason = new api.FsError('ENOENT'), cleanupFailure = new Error('controlled owned cleanup failure');
      let active = 0, releaseCount = 0, abortCount = 0, executionSettled = false, disposalSettled = false, draining;
      const cleanup = () => draining ??= (async () => { cleanupEntered.resolve(); await release.promise; active--; releaseCount++; if (cleanupFails) throw cleanupFailure; })();
      const filesystem = view(new api.MemoryFileSystem(), { async lstat(_path, options) { active++; admitted.resolve(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { abortCount++; reject(options.signal.reason); }, { once: true })); } });
      const shell = new api.Shell({ fs: filesystem }).use(api.agentCommands());
      shell.use(async (context, next) => { if (context.command === 'du') context.registerCleanup(cleanup); return next(); });
      const execution = shell.exec('du -b /payload', { signal: caller.signal, stdout: owned(new AbortController().signal) }).then(value => { executionSettled = true; return value; }, error => { executionSettled = true; throw error; }); void execution.catch(() => {});
      try {
        await admitted.promise; caller.abort(reason);
        const disposal = shell.dispose(); assert.equal(shell.dispose(), disposal);
        const observedDisposal = disposal.then(value => { disposalSettled = true; return value; }, error => { disposalSettled = true; throw error; }); void observedDisposal.catch(() => {});
        await cleanupEntered.promise; await turn(); assert.equal(executionSettled, false); assert.equal(disposalSettled, false);
        release.resolve(); await assert.rejects(execution, error => error === reason);
        if (cleanupFails) await assert.rejects(observedDisposal, error => error === cleanupFailure); else await observedDisposal;
        assert.deepEqual({ active, releaseCount, abortCount }, { active: 0, releaseCount: 1, abortCount: 1 });
        assert.equal(caller.signal.reason, reason);
        outcomes.push({ cleanupFails, callerReasonPreserved: true, active, releaseCount, abortCount, disposalFailureExpected: cleanupFails });
      } finally { release.resolve(); await shell.dispose().catch(() => {}); }
    }
    return { overlappingSchedules: outcomes, wholeCallerAbortUsedOnlyAsExplicitCaseInput: true };
  }
  if (id === 'L08') {
    const mainCaller = new AbortController(), mainClosed = new AbortController(), admitted = deferred(), siblingStarted = deferred(), siblingRelease = deferred(), siblingCaller = new AbortController(), siblingClosed = new AbortController();
    let rejectHost, hostSettled = false, siblingSettled = false; const unhandled = [];
    const observeUnhandled = reason => unhandled.push(reason); process.on('unhandledRejection', observeUnhandled);
    const main = fixture(api, { signal: mainCaller.signal, stdout: owned(mainClosed.signal), fs: view(new api.MemoryFileSystem(), { async lstat() { admitted.resolve(); return new Promise((_resolve, reject) => { rejectHost = reason => { hostSettled = true; reject(reason); }; }); } }) });
    const sibling = new api.Shell({ fs: await memory(api, { '/payload': '1234567' }) }).use(api.agentCommands());
    const siblingExecution = sibling.exec('du -b /payload', { signal: siblingCaller.signal, stdout: owned(siblingClosed.signal, async () => { siblingStarted.resolve(); await siblingRelease.promise; }) }).then(value => { siblingSettled = true; return value; }); void siblingExecution.catch(() => {});
    const execution = Promise.resolve(api.createDuCommand().execute(main.value)); void execution.catch(() => {});
    try {
      await Promise.all([admitted.promise, siblingStarted.promise]); const reason = new api.FsError('EPIPE'); mainClosed.abort(reason);
      await assert.rejects(execution, error => error === reason); assert.equal(hostSettled, false); assert.equal(siblingSettled, false);
      assert.equal(mainCaller.signal.aborted, false); assert.equal(siblingCaller.signal.aborted, false); assert.equal(siblingClosed.signal.aborted, false);
      rejectHost(new Error('late opaque provider failure')); await turn(); assert.equal(hostSettled, true); assert.deepEqual(unhandled, []);
      siblingRelease.resolve(); exact(await siblingExecution, { exitCode: 0, stdout: '7\t/payload\n', stderr: '' });
      exact(await sibling.exec('echo sibling-usable'), { exitCode: 0, stdout: 'sibling-usable\n', stderr: '' });
    } finally { siblingRelease.resolve(); if (!hostSettled && rejectHost) rejectHost(new Error('explicit fixture cleanup')); await main.close(); await sibling.dispose(); process.removeListener('unhandledRejection', observeUnhandled); }
    return { siblingUsable: true, callerUnaborted: true, opaquePendingAtDuSettlement: true, lateRejectionObserved: true, forcedOpaquePreemptionClaim: false };
  }
  throw new Error(`UNIMPLEMENTED_FROZEN_CASE:${id}`);
}
