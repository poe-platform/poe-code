import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { expectedState, scalarPayload, sourceReviewFields } from './mapping.mjs';

const immediate = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
};
const statValue = type => ({ type, size: 0, mode: type === 'file' ? 33188 : 16877, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 });
const propfindBody = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:creationdate/><d:getetag/><v:timestamps xmlns:v="urn:virtual-bash:metadata"/></d:prop></d:propfind>';
const xml = directory => '<?xml version="1.0" encoding="utf-8"?><z:multistatus xmlns:z="DAV:"><z:response><z:href>/dav/d</z:href><z:propstat><z:prop>'
  + `<z:resourcetype>${directory ? '<z:collection/>' : ''}</z:resourcetype><z:getcontentlength>0</z:getcontentlength>`
  + '<z:getlastmodified>Wed, 26 Aug 2026 12:00:00 GMT</z:getlastmodified><z:creationdate>2026-08-01T00:00:00Z</z:creationdate>'
  + '</z:prop><z:status>HTTP/1.1 200 OK</z:status></z:propstat></z:response></z:multistatus>';

export async function executeCase(api, plan, options) {
  assert.equal(options.authorization, 'ROOT_EXECUTION_AUTHORIZED', 'no product fixture without execution route');
  const caller = new AbortController();
  const callerReason = plan.id === 'C03' ? new api.FsError('EACCES') : Object.assign(new Error('caller-stop'), { code: 'ENOENT' });
  const trace = { calls: [], transport: [], backing: [], stdout: [], stderr: [], observations: [], events: [], violations: [], resources: 0, released: 0, cleanupCalls: 0, late: [], writes: [] };
  let closed = false;
  let closing;
  let settled = false;
  let disposed = false;
  let shell;
  let disposal;
  let runtimeSignal;
  let responseReaders = 0;
  const responses = [];
  const releases = [];
  const cleanupGate = deferred();
  const k2 = ['C02', 'C03', 'C04'].includes(plan.id);
  const pendingDesign = Object.keys(plan.expected).filter(key => sourceReviewFields.has(key));
  if (plan.id === 'L26') pendingDesign.push('state: no observer command is admissible under the unchanged maxCommands=2/source; final cwd requires candidate source review');
  if (plan.diagnostic) pendingDesign.push('incremental bounded diagnostic construction: source review, not an RSS assertion');
  const violate = message => { trace.violations.push(message); throw new api.FsError('EIO', { message }); };
  const close = () => {
    if (closing) return closing;
    closed = true;
    trace.cleanupCalls++;
    trace.events.push('cleanup-start');
    closing = (async () => {
      for (const release of releases) release();
      if (k2) await cleanupGate.promise;
      await immediate();
      trace.events.push('cleanup-end');
    })();
    return closing;
  };
  const held = () => {
    if (closed) return violate('resource acquired after cleanup admission closed');
    const gate = deferred();
    trace.resources++;
    let released = false;
    const release = (error, value) => {
      if (released) return;
      released = true;
      trace.resources--;
      trace.released++;
      if (error) gate.reject(error); else gate.resolve(value);
    };
    return { gate, release };
  };
  const abortDuring = resource => {
    caller.abort(callerReason);
    disposal = shell.dispose().then(() => { disposed = true; });
    void disposal.catch(error => trace.late.push(String(error)));
    setImmediate(() => {
      if (settled || disposed) trace.violations.push('exec/dispose settled before cooperative cleanup gate');
      resource?.();
      cleanupGate.resolve();
    });
  };
  const capture = target => async chunk => {
    assert(chunk instanceof Uint8Array);
    if (target.reduce((sum, entry) => sum + entry.length, 0) + chunk.length > 8388608) return violate('fixture output capture exceeded 8MiB');
    target.push(Buffer.from(chunk));
  };
  const stdout = { write: async chunk => {
    if (trace.calls.length !== plan.calls.length || trace.calls.some(call => call.result === 'pending')) return violate('stdout began before admitted VFS work settled');
    await capture(trace.stdout)(chunk);
    trace.events.push('stdout-enter');
    if (plan.id === 'O01') {
      const resource = held();
      releases.push(() => resource.release());
      setImmediate(() => { if (settled) trace.violations.push('exec did not await stdout'); resource.release(); });
      await resource.gate.promise;
    }
    if (['O02', 'O03', 'O04'].includes(plan.id)) throw Object.assign(new Error(plan.id === 'O02' ? 'closed' : 'sink-failed'), plan.id === 'O02' ? { code: 'EPIPE' } : {});
    if (plan.id === 'C04') {
      const resource = held();
      releases.push(() => resource.release());
      abortDuring();
      await resource.gate.promise;
    }
    trace.events.push('stdout-end');
  } };
  const stderr = { write: async chunk => {
    await capture(trace.stderr)(chunk);
    if (plan.id === 'O04') throw new Error('diagnostic-sink-failed');
  } };
  const memory = new api.MemoryFileSystem();
  const directories = new Set(['/w', '/home', '/old', '/p/t', '/q/t', '/w/t', '/d', '/e', plan.cwd]);
  for (const call of plan.calls) directories.add(call.path);
  if (plan.id === 'B10') {
    directories.delete('/alias/t');
    directories.add('/physical/t');
  }
  const supportedMemoryPath = path => path.split("/").every(component => Buffer.byteLength(component) <= 255);
  for (const path of directories) if (supportedMemoryPath(path)) await memory.mkdir(path, { recursive: true });
  if (plan.id === 'B10') await memory.symlink('/physical', '/alias');
  if (plan.id === 'A01') await memory.chmod('/d', 0);
  if (plan.id === 'S07') await memory.writeFile('/out', Buffer.from('OLD'));
  let backend = memory;
  const backing = filesystem => new Proxy(filesystem, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return (...args) => { trace.backing.push({ method: String(key), path: args[0], mode: typeof args[1] === 'number' ? args[1] : undefined }); return value.apply(target, args); };
  } });
  if (plan.id === 'A02') backend = new api.ReadOnlyFileSystem(backing(memory));
  if (plan.id === 'A03') {
    const mounted = new api.MemoryFileSystem();
    await mounted.mkdir('/d');
    backend = new api.MountFileSystem({ root: memory, mounts: { '/m': new api.ReadOnlyFileSystem(backing(mounted)) } });
  }
  if (['A04', 'A05', 'A06'].includes(plan.id)) {
    backend = new api.WebDavFileSystem({ baseUrl: 'https://dav.invalid/dav/', fetch: async (url, init) => {
      const index = trace.transport.length;
      trace.transport.push({ url, method: init.method, headers: [...new Headers(init.headers)], body: init.body, credentials: init.credentials, redirect: init.redirect });
      if (index >= 2 || url !== 'https://dav.invalid/dav/d' || init.method !== 'PROPFIND') return violate('unexpected WebDAV transport request');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Depth'), '0');
      assert.equal(headers.get('Cache-Control'), 'no-cache');
      assert.equal(headers.get('Content-Type'), 'application/xml; charset=utf-8');
      assert.equal(init.body, propfindBody);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'manual');
      assert(init.signal instanceof AbortSignal && !init.signal.aborted);
      if (index === 1 && plan.id === 'A05') return new Response(null, { status: 403 });
      const data = Buffer.from(xml(!(index === 1 && plan.id === 'A06')));
      responseReaders++;
      const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(data)); controller.close(); responseReaders--; }, cancel() { responseReaders = Math.max(0, responseReaders - 1); } });
      const response = new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml' } });
      responses.push(response);
      return response;
    } });
    if (plan.id === 'A05') backend = new api.ReadOnlyFileSystem(backend);
  }
  const guarded = new Proxy(backend, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return async (...args) => {
      const method = String(key);
      if (plan.id === 'S07' && ['writeFile', 'writeStream'].includes(method) && args[0] === '/out') { trace.writes.push({ method, path: args[0] }); return value.apply(target, args); }
      if (!['stat', 'access'].includes(method)) return violate(`unexpected VFS method ${method}`);
      const index = trace.calls.length;
      const expected = plan.calls[index];
      if (trace.calls.at(-1)?.result === 'pending') return violate('next VFS probe began before previous probe settled');
      if (method === 'access' && (trace.calls.at(-1)?.method !== 'stat' || trace.calls.at(-1)?.result !== 'directory')) return violate('X_OK began without completed directory stat');
      const fsOptions = args[method === 'stat' ? 1 : 2];
      trace.calls.push({ method, path: args[0], ...(method === 'access' ? { mode: args[1] } : {}), result: 'pending' });
      const record = trace.calls.at(-1);
      trace.events.push(`${method}-enter`);
      if (!expected || method !== expected.method || args[0] !== expected.path || method === 'access' && args[1] !== 1) return violate(`unexpected VFS call ${index}:${method}`);
      if (!(fsOptions?.signal instanceof AbortSignal) || fsOptions.signal.aborted) return violate('missing/already-aborted provider signal at entry');
      runtimeSignal ??= fsOptions.signal;
      if (runtimeSignal !== fsOptions.signal) return violate('provider signal reference changed within cd');
      try {
        const outcome = expected.result;
        if (outcome?.kind === 'FsError') throw new api.FsError(outcome.code, { syscall: outcome.syscall, path: outcome.path });
        if (outcome?.kind === 'diagnostic-message') { const error = new api.FsError('EIO'); error.message = outcome.payload; throw error; }
        if (outcome === 'untyped-error-with-ENOENT-code') throw Object.assign(new Error('untyped-denial'), { code: 'ENOENT' });
        if (outcome === 'file') { record.result = 'file'; trace.events.push('stat-resolve'); return statValue('file'); }
        if (outcome === 'deferred') {
          const resource = held();
          releases.push(() => resource.release(plan.id === 'C02' ? new api.FsError('ENOENT') : undefined, method === 'stat' ? statValue('directory') : undefined));
          abortDuring();
          const result = await resource.gate.promise;
          record.result = method === 'stat' ? result.type : 'success';
          trace.events.push(`${method}-resolve`);
          return result;
        }
        const result = plan.group === "limits" && !supportedMemoryPath(args[0])
          ? method === "stat" ? statValue("directory") : undefined
          : await value.apply(target, args);
        if (method === 'stat') assert.equal(result.type, 'directory');
        if (typeof expected.result === 'string' && expected.result.startsWith('actual-FsError-')) assert.fail(`expected delegated typed ${expected.result}`);
        record.result = method === 'stat' ? result.type : 'success';
        trace.events.push(`${method}-resolve`);
        return result;
      } catch (error) {
        record.result = 'error';
        trace.events.push(`${method}-reject`);
        record.error = { typed: error instanceof api.FsError, code: error?.code, message: String(error?.message ?? error), syscall: error?.syscall, path: error?.path };
        if (typeof expected.result === 'string' && expected.result.startsWith('actual-FsError-')) {
          if (!(error instanceof api.FsError) || error.code !== expected.result.slice('actual-FsError-'.length)) trace.violations.push(`delegated actual typed error mismatch at ${method} ${args[0]}`);
        }
        throw error;
      }
    };
  } });
  const commands = new api.CommandRegistry([
    { name: 'observe', execute(context) { if (plan.id === 'O01' && !trace.events.includes('stdout-end')) return violate('observer ran before awaited output completion'); trace.observations.push({ args: [...context.args], cwd: context.cwd, env: { ...context.env } }); trace.events.push('observe'); return { exitCode: Number(context.args[0]) }; } },
    { name: 'bridge', async execute(context) { assert(context.invoke); return context.invoke('cd', ['t'], { env: { CDPATH: '/q' } }); } },
    { name: 'other', execute() { throw new Error(plan.input.payload); } },
  ]);
  shell = new api.Shell({ fs: guarded, commands, cwd: plan.cwd, env: plan.env });
  shell.use(async (context, next) => {
    if (context.command !== 'cd') return next();
    runtimeSignal = undefined;
    assert.equal(typeof context.registerCleanup, 'function');
    context.registerCleanup(close);
    if (plan.id === 'S09') context.env.CDPATH = '/q';
    return await next();
  });
  const unhandled = error => trace.late.push(String(error));
  process.on('unhandledRejection', unhandled);
  let result;
  let rejection;
  let assertionFailure;
  let cleanupFailure;
  try {
    const execOptions = { ...plan.input.execOptions, stdout, stderr };
    if (plan.group === 'cancellation') execOptions.signal = caller.signal;
    if (plan.id === 'C01') caller.abort(callerReason);
    if (plan.id === 'C05') setImmediate(() => caller.abort(callerReason));
    try { result = await shell.exec(plan.source, execOptions); }
    catch (error) { rejection = error; }
    finally { settled = true; }
    const out = Buffer.concat(trace.stdout).toString();
    const err = Buffer.concat(trace.stderr).toString();
    assert.deepEqual(trace.violations, []);
    assert.equal(trace.calls.length, plan.calls.length, 'exact probe admission count');
    if (plan.expected.rejects === 'exact-caller-reason') assert.equal(rejection, callerReason);
    else if (plan.expected.rejects?.startsWith('ShellLimitError')) {
      assert(rejection instanceof api.ShellLimitError);
      assert.equal(rejection.limit, plan.expected.rejects.split('limit=')[1]);
    } else {
      assert.equal(rejection, undefined);
      assert.equal(result.exitCode, plan.expected.cdStatus);
      assert.equal(result.stdout, out);
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(out));
      assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(err));
    }
    if (plan.expected.stdout !== undefined) assert.equal(out, plan.expected.stdout);
    if (plan.expected.stderr !== undefined) assert.equal(err, plan.expected.stderr);
    if (plan.expected.diagnosticPayload) {
      const direct = ['L01', 'L02', 'L03', 'S07'].includes(plan.id);
      assert.equal(err, `${direct ? '' : 'shell: line 1: '}${plan.expected.diagnosticPayload}\n`);
    }
    if (plan.diagnostic) assert.equal(err, `shell: line 1: ${scalarPayload(plan.row)}\n`);
    if (plan.id === 'O05') { assert.equal(err, `shell: line 1: ${plan.input.payload}\n`); assert.equal(Buffer.byteLength(err), 65809); }
    if (plan.expected.privateFailureBeforeRejection) assert.equal(err, `shell: line 1: ${plan.expected.privateFailureBeforeRejection}\n`);
    const state = expectedState(plan);
    if (state && plan.id !== 'L26') {
      assert.equal(trace.observations.length, 1);
      const snapshot = trace.observations[0];
      assert.equal(snapshot.cwd, state.cwd);
      assert.equal(snapshot.args[1], state.PWD);
      assert.equal(snapshot.args[2], state.OLDPWD ?? '');
      assert.deepEqual(snapshot.env, state.env);
    }
    if (plan.id === 'S07') assert.equal(Buffer.from(await memory.readFile('/out')).toString(), '');
    if (plan.expected.transportRequests) assert.deepEqual(trace.transport.map(entry => `${entry.method} ${new URL(entry.url).pathname} Depth:${new Headers(entry.headers).get('Depth')}`), plan.expected.transportRequests);
    else assert.equal(trace.transport.length, 0);
    if (plan.expected.backingCalls) assert.deepEqual(trace.backing.map(entry => `${entry.method} ${entry.path}${entry.mode === undefined ? '' : ` ${entry.mode}`}`), plan.expected.backingCalls);
    if (plan.expected.backingAccess) assert(trace.backing.some(entry => entry.method === 'access' && entry.path === plan.expected.backingAccess.path && entry.mode === 1));
    for (const [key, method] of [['statCalls', 'stat'], ['accessCalls', 'access']]) if (plan.expected[key] !== undefined) assert.equal(trace.calls.filter(entry => entry.method === method).length, plan.expected[key]);
    if (plan.expected.publicVfsCalls !== undefined) assert.equal(trace.calls.length, plan.expected.publicVfsCalls);
    if (plan.expected.stdoutWriteAttempts !== undefined) assert.equal(trace.stdout.length, plan.expected.stdoutWriteAttempts);
    if (plan.expected.externalWriteAttempts !== undefined) assert.equal(trace.stdout.length, plan.expected.externalWriteAttempts);
    if (plan.expected.externalStderrWriteAttempts !== undefined) assert.equal(trace.stderr.length, plan.expected.externalStderrWriteAttempts);
    if (plan.expected.externalWriteAttempt) assert.equal(out, plan.expected.externalWriteAttempt);
    if (plan.expected.capturedBytes) assert.equal(result.stdout, plan.expected.capturedBytes);
    if (plan.expected.printCount !== undefined) assert.equal(out.split('\n').length - 1, plan.expected.printCount);
    if (plan.expected.callerSignalAborted !== undefined) assert.equal(caller.signal.aborted, plan.expected.callerSignalAborted);
    if (plan.expected.writes !== undefined) assert.equal(trace.writes.length, plan.expected.writes);
    if (plan.expected.laterSuccessFixtureMustRemainUncalled) assert(!trace.calls.some(call => call.path === plan.expected.laterSuccessFixtureMustRemainUncalled));
    if (plan.expected.laterCalls !== undefined) assert.equal(trace.calls.length - plan.calls.length, plan.expected.laterCalls);
    if (plan.expected.execRejects !== undefined) assert.equal(rejection !== undefined, plan.expected.execRejects);
    if (plan.expected.diagnosticPayloadBytes !== undefined) assert.equal(Buffer.byteLength(plan.input.payload), plan.expected.diagnosticPayloadBytes);
    if (plan.expected.physicalStderrBytes !== undefined) assert.equal(Buffer.byteLength(err), plan.expected.physicalStderrBytes);
    if (plan.expected.suffixAdded !== undefined) assert.equal(err.includes(' [truncated]'), plan.expected.suffixAdded);
    if (plan.expected.forbidden) assert.deepEqual(trace.violations, []);
  } catch (error) { assertionFailure = { name: error.name, message: error.message, stack: error.stack }; }
  finally {
    try {
      cleanupGate.resolve();
      await close();
      await shell.dispose();
      await disposal;
      await immediate();
      await immediate();
      assert.equal(trace.resources, 0);
      assert.equal(responseReaders, 0);
      assert(responses.every(response => response.body?.locked === false));
      assert.deepEqual(trace.late, []);
      assert.deepEqual(trace.violations, []);
      if (k2) assert.equal(trace.cleanupCalls, 1);
    } catch (error) { cleanupFailure = { name: error.name, message: error.message, stack: error.stack }; }
    process.off('unhandledRejection', unhandled);
  }
  const paths = [...new Set(trace.calls.map(entry => entry.path))];
  const errors = [...new Set(trace.calls.filter(entry => entry.error).map(entry => JSON.stringify(entry.error)))];
  return {
    id: plan.id, status: cleanupFailure ? 'cleanup-failure' : assertionFailure ? 'assertion-failure' : pendingDesign.length ? 'public-pass-design-pending' : 'public-pass',
    cleanup: cleanupFailure ? 'failed' : 'clean', assertionFailure, cleanupFailure, pendingDesign,
    stdoutBase64: Buffer.concat(trace.stdout).toString('base64'), stderrBase64: Buffer.concat(trace.stderr).toString('base64'),
    rejection: rejection ? { name: rejection.name, message: rejection.message, code: rejection.code, limit: rejection.limit, exactCaller: rejection === callerReason } : undefined,
    paths, errors: errors.map(error => JSON.parse(error)), calls: trace.calls.map(entry => ({ ...entry, path: paths.indexOf(entry.path), ...(entry.error ? { error: errors.indexOf(JSON.stringify(entry.error)) } : {}) })),
    transport: trace.transport, observations: trace.observations, events: trace.events,
    cleanupFacts: { resources: trace.resources, released: trace.released, cleanupCalls: trace.cleanupCalls, late: trace.late },
  };
}
