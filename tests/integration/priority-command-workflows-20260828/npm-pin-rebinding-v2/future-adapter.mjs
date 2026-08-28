import assert from 'node:assert/strict';
import path from 'node:path';

const encode = bytes => Buffer.from(bytes).toString('base64');
const decode = text => new Uint8Array(Buffer.from(text, 'base64'));
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
};
const mutators = new Set(['writeFile', 'appendFile', 'writeStream', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'symlink', 'link', 'chmod', 'chown', 'utimes', 'truncate']);
const contentReads = new Set(['readFile', 'readStream']);

function chunksSource(chunks, counts, fault) {
  return {
    [Symbol.asyncIterator]() {
      counts.iterators++;
      counts.pending = (counts.pending ?? 0) + 1;
      let index = 0;
      let open = true;
      const close = () => { if (open) { open = false; counts.pending--; } };
      return {
        async next() {
          counts.next++;
          if (fault) { close(); throw fault; }
          if (index < chunks.length) return { done: false, value: decode(chunks[index++]) };
          close(); return { done: true, value: undefined };
        },
        async return() { counts.return++; close(); return { done: true, value: undefined }; },
      };
    },
  };
}

function observeFs(target, trace, fixture, api) {
  const methods = new Map();
  return new Proxy(target, {
    get(backing, name) {
      const value = Reflect.get(backing, name, backing);
      if (typeof value !== 'function') return value;
      if (methods.has(name)) return methods.get(name);
      const wrapped = (...args) => {
        const record = { method: name, paths: args.filter(argument => typeof argument === 'string'), success: false };
        trace.calls.push(record);
        if (name === 'readStream') {
          const counts = { iterators: 0, next: 0, return: 0, pending: 0 };
          record.stream = counts;
          if (fixture.fault?.path === args[0]) {
            const { code, ...options } = fixture.fault.error;
            return chunksSource([], counts, new api.FsError(code, options));
          }
          const stream = Reflect.apply(value, backing, args);
          return {
            [Symbol.asyncIterator]() {
              counts.iterators++;
              counts.pending++;
              let open = true;
              const close = () => { if (open) { open = false; counts.pending--; } };
              const iterator = stream[Symbol.asyncIterator]();
              return {
                next: async () => { counts.next++; const result = await iterator.next(); if (result.done) { record.success = true; close(); } return result; },
                return: async () => { counts.return++; const result = iterator.return ? await iterator.return() : { done: true, value: undefined }; close(); return result; },
              };
            },
          };
        }
        trace.pending = (trace.pending ?? 0) + 1;
        return Promise.resolve().then(() => Reflect.apply(value, backing, args)).then(result => { record.success = true; return result; }, error => { record.error = { code: error?.code, message: String(error) }; throw error; }).finally(() => { trace.pending--; });
      };
      methods.set(name, wrapped);
      return wrapped;
    },
  });
}

async function snapshot(fs) {
  const rows = {};
  async function walk(filename) {
    const stat = await fs.lstat(filename);
    const row = { type: stat.type, mode: stat.mode & 511 };
    if (stat.type === 'file') row.base64 = encode(await fs.readFile(filename));
    rows[filename] = row;
    if (stat.type === 'directory') for (const entry of (await fs.readdir(filename)).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) await walk(path.posix.join(filename, entry.name));
  }
  await walk('/');
  return rows;
}

function checkNamespace(before, after, expected) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(expected.changedFiles).map(name => '/work/' + name)])].sort();
  assert.deepEqual(Object.keys(after).sort(), names, 'WHOLE_ROOT_NAMESPACE');
  for (const name of names) {
    const changed = expected.changedFiles[name.slice('/work/'.length)];
    if (changed && name.startsWith('/work/')) {
      assert.equal(after[name].type, 'file'); assert.equal(after[name].base64, changed.base64, name);
      if (before[name]) assert.equal(after[name].mode, before[name].mode, name);
    } else assert.deepEqual(after[name], before[name], name);
  }
  for (const name of expected.absent) assert.equal(after['/work/' + name], undefined, name);
}

function partialOrder(events, sequence) {
  let previous = -1;
  for (const event of sequence) { const index = events.indexOf(event, previous + 1); assert.ok(index > previous, `PARTIAL_ORDER:${event}`); previous = index; }
}

function checkGuards(row, trace) {
  if (row.stdinGuard) assert.deepEqual({ iterators: trace.stdin.iterators, next: trace.stdin.next, return: trace.stdin.return }, row.stdinGuard, 'STDIN_COUNTS');
  if (row.mutationGuard) {
    const actual = trace.fs.calls.filter(call => mutators.has(call.method));
    assert.deepEqual(actual.map(call => [call.method, ...call.paths]), row.mutationGuard.exactCalls, 'MUTATION_CALLS');
    if (row.mutationGuard.successfulCalls !== undefined) assert.equal(actual.filter(call => call.success).length, row.mutationGuard.successfulCalls);
    if (row.mutationGuard.backingMutations !== undefined) assert.equal(trace.backing.calls.filter(call => mutators.has(call.method)).length, row.mutationGuard.backingMutations);
  }
  if (row.readGuard) {
    const reads = trace.fs.calls.filter(call => contentReads.has(call.method));
    if (row.readGuard.allVfsContentReads !== undefined) assert.equal(reads.length, row.readGuard.allVfsContentReads);
    for (const filename of row.readGuard.forbiddenContentPaths ?? []) assert.equal(reads.some(call => call.paths[0] === filename), false);
    for (const filename of row.readGuard.forbiddenFallbackReadFile ?? []) assert.equal(reads.some(call => call.method === 'readFile' && call.paths[0] === filename), false);
    if (row.readGuard.streamCalls) {
      const streams = reads.filter(call => call.method === 'readStream');
      assert.deepEqual(streams.map(call => [call.paths[0], call.stream.iterators]), row.readGuard.streamCalls);
      assert.equal(streams.reduce((sum, call) => sum + call.stream.next, 0), row.readGuard.next);
      assert.equal(streams.reduce((sum, call) => sum + call.stream.return, 0), row.readGuard.return);
    }
  }
  if (row.networkGuard) for (const [key, value] of Object.entries(row.networkGuard)) {
    if (key === 'partialOrder') for (const sequence of value) partialOrder(trace.events, sequence);
    else assert.deepEqual(trace.network[key], value, `NETWORK:${key}`);
  }
  if (row.lifecycleGuard) for (const [key, value] of Object.entries(row.lifecycleGuard)) {
    if (key === 'events') for (const [name, count] of Object.entries(value)) assert.equal(trace.events.filter(event => event === name).length, count, name);
    else if (key === 'partialOrder') for (const sequence of value) partialOrder(trace.events, sequence);
    else assert.deepEqual(trace.lifecycle[key], value, `LIFECYCLE:${key}`);
  }
}

export function safetyCheck(trace, code, check) {
  try { return check(); }
  catch (error) { trace.safetyStops.push({ code, message: String(error) }); throw error; }
}

export function admitFixtureRequest(trace, kind, actual, expected, closed = false) {
  return safetyCheck(trace, kind === 'authorize' ? 'AUTHORIZATION_ADMISSION_STOP' : 'REQUEST_ADMISSION_STOP', () => {
    assert.equal(closed, false, 'POST_CLOSE_ADMISSION');
    assert.ok(expected, 'EXTRA_ADMISSION');
    assert.deepEqual(actual, expected, 'UNDECLARED_REQUEST');
  });
}

export function validateCaseSafety(row, fixture, trace) {
  const check = (code, action) => { try { safetyCheck(trace, code, action); } catch {} };
  check('CLEANUP_STOP', () => { assert.equal(trace.created, 1); assert.equal(trace.disposed, 1); });
  check('PENDING_RESOURCE_STOP', () => {
    assert.equal(trace.listenersAtEnd, 0);
    for (const name of ['pendingOwnedAtEnd', 'pendingFixtureAtEnd']) assert.equal(trace.lifecycle[name], 0, name);
    for (const resource of [trace.stdin, trace.fs, trace.backing, ...(trace.responses ?? [])]) assert.equal(resource.pending, 0);
    for (const call of [...trace.fs.calls, ...trace.backing.calls]) if (call.stream) assert.equal(call.stream.pending, 0);
  });
  check('POST_CLOSE_ADMISSION_STOP', () => { assert.equal(trace.network.requestAfterClose, 0); assert.equal(trace.network.extraRequests, 0); });
  check('MANDATORY_TRACE_STOP', () => {
    assert.ok(trace.outcome && ['result', 'throw'].includes(trace.outcome.kind));
    const unmatched = [...trace.stages];
    for (const argv of row.argv) {
      const index = unmatched.findIndex(stage => JSON.stringify(stage.argv) === JSON.stringify(argv));
      assert.ok(index >= 0, `MISSING_REAL_STAGE:${JSON.stringify(argv)}`);
      const [stage] = unmatched.splice(index, 1);
      assert.ok(['result', 'throw'].includes(stage.kind), 'UNSETTLED_STAGE');
    }
    assert.equal(unmatched.length, 0, 'UNDECLARED_STAGE');
    assert.ok(trace.events.includes('shell.dispose.complete'), 'MISSING_DISPOSE_TRACE');
    for (const guard of [row.networkGuard, row.lifecycleGuard]) {
      for (const sequence of guard?.partialOrder ?? []) partialOrder(trace.events, sequence);
      for (const [name, count] of Object.entries(guard?.events ?? {})) assert.equal(trace.events.filter(event => event === name).length, count, name);
    }
    assert.equal(trace.authorizationTrace.length, trace.network.authorizations);
    assert.equal(trace.requestTrace.length, trace.network.requests);
    for (const name of ['authorizations', 'requests']) if (row.networkGuard?.[name] !== undefined) assert.equal(trace.network[name], row.networkGuard[name], `MISSING_NETWORK_TRACE:${name}`);
    for (const [index, response] of (fixture.network?.routes ?? []).entries()) {
      if (response.response && index < trace.network.requests) assert.equal(trace.network.responseDispose[index], 1, 'MISSING_RESPONSE_DISPOSAL');
    }
  });
  check('UNEXPECTED_NAMESPACE_STOP', () => {
    assert.ok(trace.before && trace.after, 'NAMESPACE_SNAPSHOT_REQUIRED');
    const allowed = new Set(Object.keys(row.expected.changedFiles).map(name => '/work/' + name));
    for (const name of new Set([...Object.keys(trace.before), ...Object.keys(trace.after)])) {
      if (allowed.has(name)) {
        if (trace.after[name]) assert.equal(trace.after[name].type, 'file', name);
        if (trace.before[name] && trace.after[name]) assert.equal(trace.after[name].mode, trace.before[name].mode, name);
      } else assert.deepEqual(trace.after[name], trace.before[name], name);
    }
  });
}

export async function runCase(api, row, fixture, defaults, networkLimits) {
  const trace = {
    id: row.id, role: 'REAL_PUBLIC_API_FUTURE_EXECUTION', created: 0, disposed: 0,
    events: [], stages: [], fs: { calls: [], pending: 0 }, backing: { calls: [], pending: 0 }, stdin: { iterators: 0, next: 0, return: 0, pending: 0 },
    network: { authorizations: 0, requests: 0, responseIterators: [], responseNext: [], responseReturn: [], responseDispose: [], requestAfterClose: 0, extraRequests: 0 },
    lifecycle: {}, requestTrace: [], authorizationTrace: [], failures: [], safetyStops: [],
  };
  const event = name => trace.events.push(name);
  const caller = new AbortController(), outputClosed = new AbortController();
  const callerReason = Object.freeze({ ...fixture.reasonTokens?.callerReason });
  const lateReason = Object.freeze({ ...fixture.reasonTokens?.lateReason });
  const acquisitionEntered = deferred(), cleanupEntered = deferred(), cleanupGate = deferred(), authorizationEntered = deferred(), opaque = deferred();
  let ownedPending = 0, listenerCount = 0, fixturePending = 0, hostClosed = false, execSettled = false, opaqueSettled = false, shell;
  const unhandled = reason => { trace.lifecycle.unhandledRejections++; trace.safetyStops.push({ code: 'UNHANDLED_REJECTION_STOP', message: String(reason) }); trace.failures.push({ kind: 'unhandled-rejection', callerReason: reason === callerReason, lateReason: reason === lateReason }); };
  trace.lifecycle.unhandledRejections = 0;
  process.on('unhandledRejection', unhandled);
  let backing;
  const stdout = [], stderr = [];
  let outputBytes = 0, plainWrites = 0, ownedWrites = 0;
  const sink = target => ({ async write(chunk) { outputBytes += chunk.length; safetyCheck(trace, 'CAPTURE_BOUND_STOP', () => assert.ok(outputBytes <= 65536, 'CAPTURE_BOUND')); target.push(new Uint8Array(chunk)); } });
  const stdoutSink = fixture.sink ? {
    async write() { plainWrites++; throw new Error('UNEXPECTED_PLAIN_WRITE'); },
    ownedOutput: { consumerClosed: outputClosed.signal, async write() { ownedWrites++; throw new Error('UNEXPECTED_OWNED_WRITE'); } },
  } : sink(stdout);
  async function authorize(request) {
    const index = trace.network.authorizations++;
    const actual = { url: request.url, method: request.method, attempt: request.attempt, ...(request.redirectFrom === undefined ? {} : { redirectFrom: request.redirectFrom }) };
    trace.authorizationTrace.push(actual); event(`authorize:${index}`);
    if (fixture.infrastructure === 'opaque-authorizer') {
      admitFixtureRequest(trace, 'authorize', actual, index === 0 ? fixture.authorization : undefined, hostClosed || execSettled); event('authorization.enter'); fixturePending++;
      authorizationEntered.resolve();
      try { return await opaque.promise; }
      catch (reason) { trace.lifecycle.opaqueLateRejects = (trace.lifecycle.opaqueLateRejects ?? 0) + 1; trace.lifecycle.lateReasonSameObject = reason === lateReason; throw reason; }
      finally { fixturePending--; opaqueSettled = true; }
    }
    const route = fixture.network?.routes[index];
    admitFixtureRequest(trace, 'authorize', actual, route?.authorize, hostClosed || execSettled);
    return true;
  }
  async function transport(request) {
    const index = trace.network.requests++;
    if (hostClosed || execSettled) { trace.network.requestAfterClose++; safetyCheck(trace, 'POST_CLOSE_REQUEST_STOP', () => { throw new Error('POST_CLOSE_REQUEST_STOP'); }); }
    const route = fixture.network?.routes[index];
    if (!route) { trace.network.extraRequests++; safetyCheck(trace, 'EXTRA_REQUEST_STOP', () => { throw new Error('EXTRA_REQUEST_STOP'); }); }
    const pending = fixture.infrastructure === 'cooperative-transport';
    let cleanup, acquisitionSettled = false, rejectAcquisition, admitted = false;
    const acquisition = deferred();
    const abort = () => { event('host.acquire.reject'); rejectAcquisition(request.signal.reason); };
    const clean = () => cleanup ??= (async () => {
      if (pending) { hostClosed = true; event('host.cleanup.start'); cleanupEntered.resolve(); await cleanupGate.promise; }
      await acquisition.promise.catch(() => {});
      if (pending) { request.signal.removeEventListener('abort', abort); listenerCount--; event('host.cleanup.finish'); }
      if (admitted) ownedPending--;
    })();
    safetyCheck(trace, 'COOPERATIVE_HOOK_STOP', () => { assert.equal(typeof request.registerCleanup, 'function', 'COOPERATIVE_HOOK_REQUIRED'); request.registerCleanup(clean); }); event('host.cleanup.register');
    try {
      request.signal.throwIfAborted(); ownedPending++; admitted = true; event('host.acquire.admit');
      const parts = []; let bodyBytes = 0;
      if (request.body) for await (const chunk of request.body) { bodyBytes += chunk.length; safetyCheck(trace, 'REQUEST_BODY_BOUND_STOP', () => assert.ok(bodyBytes <= 4096)); parts.push(new Uint8Array(chunk)); }
      const actual = { url: request.url, method: request.method, headers: request.headers.map(pair => [...pair]), bodyBase64: request.body ? encode(Buffer.concat(parts)) : null };
      trace.requestTrace.push(actual); admitFixtureRequest(trace, 'request', actual, route.request); event(`request:${index}`);
      if (pending) {
        const wait = new Promise((_, reject) => { rejectAcquisition = reject; });
        request.signal.addEventListener('abort', abort, { once: true }); listenerCount++;
        acquisitionEntered.resolve();
        try { return await wait; }
        finally { acquisitionSettled = true; acquisition.resolve(); }
      }
      assert.ok(route.response, 'RESPONSE_REQUIRED');
      const counts = { iterators: 0, next: 0, return: 0, pending: 0 };
      let disposed;
      for (const key of ['responseIterators', 'responseNext', 'responseReturn', 'responseDispose']) trace.network[key].push(0);
      const body = chunksSource(route.response.chunks, counts);
      trace.responses ??= [];
      trace.responses.push(counts);
      const response = {
        status: route.response.status, statusText: route.response.statusText, headers: route.response.headers.map(pair => [...pair]), body,
        dispose() {
          return disposed ??= Promise.resolve().then(() => {
            trace.network.responseDispose[index]++; event(`dispose:${index}`);
            if (fixture.sink) outputClosed.abort(new api.FsError(fixture.sink.reason.code, { syscall: fixture.sink.reason.syscall }));
          });
        },
      };
      acquisitionSettled = true; acquisition.resolve();
      return response;
    } finally {
      if (!acquisitionSettled) acquisition.resolve();
      try { await clean(); } catch (error) { trace.safetyStops.push({ code: 'HOST_CLEANUP_STOP', message: String(error) }); throw error; }
    }
  }
  try {
    backing = new api.MemoryFileSystem();
    await backing.mkdir('/work', { recursive: true });
    for (const [name, entry] of Object.entries(fixture.files)) {
      await backing.mkdir(path.posix.dirname('/work/' + name), { recursive: true });
      await backing.writeFile('/work/' + name, decode(entry.base64), { mode: 420 });
    }
    trace.before = await snapshot(backing);
    const underlying = fixture.infrastructure === 'readonly-memory' ? new api.ReadOnlyFileSystem(observeFs(backing, trace.backing, {}, api)) : backing;
    const fs = observeFs(underlying, trace.fs, fixture, api);
    shell = new api.Shell({ fs, cwd: defaults.cwd, env: { ...defaults.env }, limits: { ...defaults.shellLimits } }).use(api.agentCommands());
    trace.created++;
    shell.use(async (context, next) => {
      const stage = { argv: [context.command, ...context.args], stdinIsDefault: context.stdinIsDefault, kind: 'pending' };
      trace.stages.push(stage);
      try { const result = await next(); stage.kind = 'result'; stage.exitCode = result.exitCode; return result; }
      catch (reason) { stage.kind = 'throw'; stage.callerReasonSameObject = reason === callerReason; throw reason; }
    });
    if (fixture.network || fixture.authorization) shell.use(api.networkCommands({ authorize, transport, limits: { ...networkLimits } }));
    const options = { signal: caller.signal, stdout: stdoutSink, stderr: sink(stderr) };
    if (fixture.stdin.kind === 'chunks') options.stdin = chunksSource(fixture.stdin.base64, trace.stdin);
    const execution = shell.exec(row.script, options).then(result => {
      execSettled = true; event('exec:settle'); trace.outcome = { kind: 'result', exitCode: result.exitCode, stdoutBase64: encode(result.stdoutBytes), stderrBase64: encode(result.stderrBytes) };
    }, reason => {
      execSettled = true; event('exec.reject'); event('exec:settle');
      trace.outcome = { kind: 'throw', callerReasonSameObject: reason === callerReason, stdoutBase64: encode(Buffer.concat(stdout)), stderrBase64: encode(Buffer.concat(stderr)) };
      trace.lifecycle.callerReasonSameObject = reason === callerReason;
    });
    if (fixture.infrastructure === 'cooperative-transport') {
      await acquisitionEntered.promise; caller.abort(callerReason); await cleanupEntered.promise;
      await turn(); safetyCheck(trace, 'CLEANUP_BARRIER_STOP', () => assert.equal(execSettled, false, 'EXEC_MUST_WAIT_CLEANUP_GATE')); cleanupGate.resolve();
    }
    if (fixture.infrastructure === 'opaque-authorizer') {
      await authorizationEntered.promise; caller.abort(callerReason); await execution;
      trace.lifecycle.opaquePendingAtExecSettlement = !opaqueSettled;
      opaque.reject(lateReason); await turn();
    }
    await execution;
  } catch (error) { trace.failures.push({ kind: 'adapter-or-execution', message: String(error), stack: error?.stack }); }
  finally {
    cleanupGate.resolve();
    if (fixture.infrastructure === 'opaque-authorizer' && !opaqueSettled) opaque.reject(lateReason);
    if (!execSettled) caller.abort(callerReason);
    if (shell) {
      try {
        const disposal = shell.dispose();
        if (fixture.id === 'C05') {
          const second = shell.dispose(); trace.sharedDisposePromise = second === disposal;
          const settled = await Promise.allSettled([disposal, second]);
          assert.equal(second, disposal);
          for (const result of settled) if (result.status === 'rejected') throw result.reason;
        } else await disposal;
        trace.disposed++; event('shell.dispose.complete');
      } catch (error) { trace.safetyStops.push({ code: 'SHELL_CLEANUP_STOP', message: String(error) }); trace.failures.push({ kind: 'cleanup', message: String(error) }); }
    }
    await turn();
    process.removeListener('unhandledRejection', unhandled);
  }
  try { trace.after = await snapshot(backing); }
  catch (error) { trace.safetyStops.push({ code: 'NAMESPACE_SNAPSHOT_STOP', message: String(error) }); }
  for (const [index, counts] of (trace.responses ?? []).entries()) {
    trace.network.responseIterators[index] = counts.iterators; trace.network.responseNext[index] = counts.next; trace.network.responseReturn[index] = counts.return;
  }
  Object.assign(trace.lifecycle, { pendingOwnedAtEnd: ownedPending, pendingFixtureAtEnd: fixturePending, postCloseAdmission: trace.network.requestAfterClose, callerAborted: caller.signal.aborted });
  if (fixture.sink) trace.lifecycle.settlement = trace.outcome?.kind === 'result' && trace.outcome.exitCode === 141 ? 'result141-not-reason-throw' : trace.outcome?.kind;
  trace.listenersAtEnd = listenerCount;
  trace.outputWrites = { plain: plainWrites, owned: ownedWrites };
  validateCaseSafety(row, fixture, trace);
  try {
    assert.equal(trace.failures.length, 0); assert.equal(trace.created, 1); assert.equal(trace.disposed, 1);
    assert.equal(listenerCount, 0); assert.equal(ownedPending, 0); assert.equal(fixturePending, 0);
    assert.equal(trace.stdin.pending, 0); assert.equal(trace.fs.pending, 0); assert.equal(trace.backing.pending, 0);
    for (const call of [...trace.fs.calls, ...trace.backing.calls]) if (call.stream) assert.equal(call.stream.pending, 0, 'FILESYSTEM_CURSOR_UNREAPED');
    for (const response of trace.responses ?? []) assert.equal(response.pending, 0, 'RESPONSE_CURSOR_UNREAPED');
    if (fixture.infrastructure === 'opaque-authorizer') assert.equal(trace.lifecycle.lateReasonSameObject, true);
    assert.equal(trace.outcome.kind, row.expected.kind);
    if (row.expected.kind === 'result') assert.equal(trace.outcome.exitCode, row.expected.exitCode);
    else { assert.equal(Object.hasOwn(trace.outcome, 'exitCode'), false); assert.equal(trace.outcome.callerReasonSameObject, true); }
    assert.equal(trace.outcome.stdoutBase64, row.expected.stdoutBase64); assert.equal(trace.outcome.stderrBase64, row.expected.stderrBase64);
    const unmatched = [...trace.stages];
    row.argv.forEach((argv, index) => {
      const match = unmatched.findIndex(stage => JSON.stringify(stage.argv) === JSON.stringify(argv));
      assert.ok(match >= 0, `MISSING_REAL_STAGE:${JSON.stringify(argv)}`);
      const [stage] = unmatched.splice(match, 1);
      if (row.expected.stageExitCodes[index] === null) assert.equal(stage.kind, 'throw');
      else { assert.equal(stage.kind, 'result'); assert.equal(stage.exitCode, row.expected.stageExitCodes[index]); }
    });
    assert.equal(unmatched.length, 0, 'UNDECLARED_STAGE');
    if (row.literalChildArgv) trace.findChildQualification = { expectedLiteralArgv: row.literalChildArgv, witness: 'exact public find output and VFS effects only; aggregate child executor bypasses middleware; no fabricated invoke receipt' };
    if (fixture.sink) { assert.equal(plainWrites, fixture.sink.plainWritesAllowed); assert.equal(ownedWrites, fixture.sink.ownedWritesAllowed); }
    checkNamespace(trace.before, trace.after, row.expected); checkGuards(row, trace);
    trace.pass = trace.safetyStops.length === 0;
  } catch (error) { trace.pass = false; trace.failures.push({ kind: 'assertion', message: String(error), stack: error?.stack }); }
  return trace;
}
