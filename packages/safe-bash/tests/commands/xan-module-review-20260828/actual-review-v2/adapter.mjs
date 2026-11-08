import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { source, sink, mockFS, deferred } from '../mocks.mjs';
import { bytes } from '../core.mjs';
import { executeCase, assertCase, beforeIO } from '../preparation-v2/cases.mjs';
import { matcher } from '../preparation-v2/diagnostics.mjs';
import { assertLogicalVectors, guards, assertGuard } from '../preparation-v2/scenarios.mjs';
import { generator, digestSink } from '../preparation-v2/resources.mjs';
import { runExtra } from '../actual-review-v1/extra.mjs';

export function raw(record) {
  return { result: record.result, failed: record.failed, error: record.reason instanceof Error ? { name: record.reason.name, message: record.reason.message } : record.reason,
    stdoutBase64: record.stdout?.toString('base64'), stderrBase64: record.stderr?.toString('base64'), events: record.events,
    inputEvents: record.inputEvents, fsEvents: record.fsEvents, closed: record.closed,
    files: Object.fromEntries(Object.entries(record.files ?? {}).map(([name, data]) => [name, data.toString('base64')])) };
}
export function hostFor(contracts, files, settings = {}) {
  return mockFS(files, { errorFactory: (code, filename) => new contracts.FsError(code, { path: filename }), ...settings });
}
function rowMatchers(row) {
  if (!row.expected.stderr.precision) return new Map();
  const bound = { ...row, id: row.originalId ?? row.id }; const validator = matcher(bound);
  return new Map([[row.id, { assert(data) { validator.assert(data, bound); } }]]);
}
export async function invoke(module, contracts, args, options = {}) {
  const controller = options.controller ?? new AbortController(); const callbacks = []; const events = [];
  const host = options.host ?? hostFor(contracts, options.files ?? {}, options.fs);
  const stdin = options.stdin ?? source(Buffer.from(options.input ?? ''), { signal: controller.signal, ...options.source });
  const stdout = sink(65536, { retain: true }); const stderr = sink(65536, { retain: true });
  const context = { command: 'xan', args, fs: host.fs, cwd: '/work', env: { KEEP: 'parent' }, signal: controller.signal,
    stdin, stdinIsDefault: options.origin ?? false, stdout: options.stdout ?? stdout, stderr,
    ...(options.noHook ? {} : { registerCleanup(callback) { events.push('register'); callbacks.push(callback); options.onRegister?.(callback); } }) };
  let result; let reason; let failed = false;
  try { result = await module.createXanCommand(options.factory).execute(context); } catch (error) { failed = true; reason = error; }
  events.push('command-settle'); const closures = await Promise.allSettled(callbacks.map(callback => callback())); events.push('root-drain');
  if (closures.some(item => item.status === 'rejected')) {
    const error = Error('unexpected cooperative cleanup rejection'); error.name = 'CleanupFailure'; error.observation = { events, failures: closures.filter(item => item.status === 'rejected').map(item => String(item.reason)) }; throw error;
  }
  return { context, result, reason, failed, events, closed: true, cleanupFailures: closures.filter(item => item.status === 'rejected').map(item => item.reason),
    stdout: stdout.finish().data, stderr: stderr.finish().data, files: host.snapshot(), inputEvents: stdin.events ?? [], fsEvents: host.events };
}

export async function run({ job, module, contracts, api, documents, rows, limits, emit, layout }) {
  const report = async observation => { await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation }); return observation; };
  if (job.kind === 'unmet') { await report({ target: job.target, reason: job.reason, executed: false }); return { status: 'BLOCKED', reason: job.reason }; }
  if (['factory', 'loader', 'workflow', 'cancellation', 'destination'].includes(job.kind)) return runExtra({ job: { ...layout, ...job, limits }, module, contracts, emit });
  if (job.kind === 'case') {
    const row = rows.find(row => row.id === job.row);
    const record = await executeCase(module.createXanCommand().execute, row, { ...job, fs: { errorFactory: (code, filename) => new contracts.FsError(code, { path: filename }) } });
    await report({ ...raw({ ...record, reason: record.escaping, stdout: record.stdout.data, stderr: record.stderr.data, closed: record.cleanup.drained }), cleanup: record.cleanup, deliveryLengths: record.deliveryLengths, chargedInputBytes: record.chargedInputBytes });
    if (record.cleanup.failures) { const error = Error('cooperative cleanup failed'); error.name = 'CleanupFailure'; throw error; }
    assertCase(row, record, rowMatchers(row)); assertLogicalVectors(documents, row, record); return;
  }
  if (job.kind === 'guard') {
    const spec = guards(limits)[job.guardIndex]; let ioCalls = 0; let refused = false; let error;
    const context = { command: 'xan', args: spec.value, cwd: '/work', env: {}, signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { ioCalls++; throw Error('POISON_INPUT'); } }, fs: new Proxy({}, { get() { ioCalls++; throw Error('POISON_FS'); } }),
      stdout: { async write() { ioCalls++; } }, stderr: { async write() {} } };
    try { if (spec.kind === 'limit') module.createXanCommand({ limits: { [spec.name]: spec.value } }); else refused = (await module.createXanCommand().execute(context)).exitCode !== 0; }
    catch (caught) { refused = true; error = { name: caught.name, message: caught.message }; }
    const observation = await report({ ioCalls, refused, error }); assertGuard(spec, observation); return;
  }
  if (job.kind === 'phase') {
    const row = rows.find(row => row.id === job.row); const input = bytes(row.stdin); const boundary = input.indexOf(10) + 1;
    const lengths = job.delivery === 'split' ? [...Array(boundary).fill(1)] : [job.delivery === 'one' ? boundary : input.length];
    let acquired = 0; let reads = 0; let released = 0; let charged = 0; let offset = 0;
    const host = hostFor(contracts, { 'input.csv': { base64: input.toString('base64') } }, { poison: beforeIO(row) });
    host.fs.readStream = () => { acquired++; if (beforeIO(row)) throw Error('POISON_FILE'); return { [Symbol.asyncIterator]() { return {
      async next() { const count = lengths[reads++]; if (count === undefined) throw Error('POISON_AFTER_LOGICAL_HEADER'); charged += count; const value = Buffer.from(input.subarray(offset, offset + count)); offset += count; return { done: false, value }; },
      async return() { released++; return { done: true }; },
    }; } }; };
    const record = await invoke(module, contracts, [...row.argv, 'input.csv', '-o', 'out.csv'], { host });
    await report({ ...raw(record), acquired, reads, released, charged, logicalHeaderBytes: boundary });
    assert.equal(record.failed, false); assert.equal(record.result.exitCode, 1); assert.equal(record.stdout.length, 0);
    assert.equal(Object.hasOwn(record.files, 'out.csv'), false); assert.deepEqual(record.files['input.csv'], input);
    if (beforeIO(row)) { assert.equal(acquired, 0); assert.equal(record.fsEvents.length, 0); }
    else { assert.equal(reads, lengths.length); assert.equal(released, 1); assert.equal(charged, lengths.reduce((total, length) => total + length, 0)); }
    rowMatchers(row).get(row.id).assert(record.stderr, row); return;
  }
  if (job.kind === 'alias') {
    const kind = job.aliasKind; const initial = { 'input.csv': { utf8: kind === 'partial-space' ? 'ack\n' : 'result\n' }, ...(!['new', 'raced-wx', 'unsupported-wx'].includes(kind) ? { 'out.csv': { utf8: 'original' } } : {}) };
    if (kind === 'missing-input') delete initial['input.csv'];
    const settings = { unknownIdentity: ['unknown', 'invalid-comparison', 'permission'].includes(kind), comparison: kind === 'unknown' ? 'unknown' : kind === 'invalid-comparison' ? 'INVALID' : undefined,
      aliases: kind === 'hardlink' ? { '/work/out.csv': '/work/input.csv' } : {}, links: kind === 'followed-symlink' ? { '/work/out.csv': '/work/input.csv' } : kind === 'dangling-symlink' ? { '/work/out.csv': '/work/missing' } : {},
      noWriteStream: kind === 'fallback', noReadStream: kind === 'missing-readStream', race: kind === 'raced-wx', unsupportedWx: kind === 'unsupported-wx', failAfterPrefix: kind === 'partial-space' };
    let host = hostFor(contracts, initial, settings); const originalBacking = host.fs;
    if (job.wrapper === 'copy-up') host = hostFor(contracts, initial, settings);
    const calls = []; const backing = host.fs;
    if (kind === 'partial-space') {
      const write = backing.writeStream;
      backing.writeStream = (filename, input, options) => write(filename, { async *[Symbol.asyncIterator]() { for await (const chunk of input) { yield chunk.subarray(0, 3); return; } } }, options);
    }
    if (kind === 'permission') backing.compareEntry = async () => { throw new contracts.FsError('EACCES', { path: '/work/out.csv' }); };
    if (kind === 'readonly') backing.writeStream = async () => { throw new contracts.FsError('EROFS', { path: '/work/out.csv' }); };
    if (job.wrapper !== 'direct') {
      host.fs = Object.fromEntries(Object.entries(backing).map(([name, method]) => [name, typeof method === 'function' ? async function(...args) { calls.push(name); return method(...args); } : method]));
      if (backing.readStream) host.fs.readStream = (...args) => { calls.push('readStream'); return backing.readStream(...args); };
      if (backing.compareEntry) host.fs.compareEntry = (name, peer, peerName, settings) => backing.compareEntry(name, peer === host.fs ? backing : peer, peerName, settings);
    }
    const record = await invoke(module, contracts, ['headers', '-j', kind === 'borrowed-existing' ? '-' : 'input.csv', '-o', kind === 'same-path' ? 'input.csv' : 'out.csv'], { host, input: 'result\n' });
    await report({ ...raw(record), wrapper: job.wrapper, calls, backingChanged: originalBacking !== backing, copyUpModel: job.wrapper === 'copy-up' ? 'entire coherent independently allocated backing rebound; aliases preserved, not deployed overlay' : undefined });
    assert.equal(record.failed, false); assert.equal(record.result.exitCode, ['new', 'distinct-complete', 'fallback'].includes(kind) ? 0 : 1);
    if (initial['input.csv']) assert.deepEqual(record.files['input.csv'], Buffer.from(initial['input.csv'].utf8));
    const writes = record.fsEvents.filter(event => event.method.startsWith('write'));
    if (['new', 'distinct-complete', 'fallback'].includes(kind)) assert.deepEqual(record.files['out.csv'], Buffer.from('result\n'));
    if (['raced-wx', 'unsupported-wx'].includes(kind)) assert.deepEqual(writes.map(event => event.flag), ['wx']);
    if (kind === 'raced-wx') assert.deepEqual(record.files['out.csv'], Buffer.from('raced\n'));
    if (kind === 'partial-space') assert.deepEqual(record.files['out.csv'], Buffer.from('ack'));
    if (['same-path', 'hardlink', 'followed-symlink', 'dangling-symlink', 'unknown', 'borrowed-existing', 'invalid-comparison', 'permission', 'missing-input'].includes(kind)) assert.equal(writes.length, 0);
    if (['hardlink', 'distinct-complete'].includes(kind)) assert.equal(record.fsEvents.filter(event => event.method === 'compareEntry').length, 0);
    if (record.result.exitCode === 1) assert.match(record.stderr.toString(), /xan headers:/); return;
  }
  if (job.kind === 'authority') {
    const host = hostFor(contracts, { 'input.csv': { utf8: 'result\n' }, 'out.csv': { utf8: 'original' } }, { unknownIdentity: true }); const calls = [];
    host.fs.compareEntry = async (left, peer, right, options) => { calls.push({ left, right, samePeer: peer === host.fs, signalPresent: options.signal instanceof AbortSignal }); return job.relation === 'invalid' ? 'bad' : job.relation === 'conflict' ? 'same' : job.relation; };
    const record = await invoke(module, contracts, ['headers', '-j', 'input.csv', '-o', 'out.csv'], { host });
    await report({ ...raw(record), calls, conflictPrerequisite: job.relation === 'conflict' ? 'single FileSystem interface admits one authority; two distinct operand-authority disagreement not injectable through this command context' : undefined });
    assert.equal(calls.length, 1); assert.ok(calls.every(call => call.samePeer && call.signalPresent)); assert.equal(record.result.exitCode, job.relation === 'distinct' ? 0 : 1);
    if (job.relation === 'conflict') return { status: 'BLOCKED', reason: 'two-authority conflict unexercised; same assertion observed, not conflict coverage' }; return;
  }
  if (job.kind === 'ownership' || job.kind === 'header') {
    const borrowed = job.kind === 'header' || job.ownership === 'borrowed'; const header = job.kind === 'header' || job.stop === 'header';
    const data = job.kind === 'header' && job.delivery === 'delivered-invalid-tail' ? Buffer.from([97, 44, 98, 10, 255, 34]) : Buffer.from('a,b\n0,1\n2,3\n');
    const lengths = job.kind === 'header' ? [job.delivery === 'delivered-invalid-tail' ? 6 : 4, ...(job.delivery === 'poison-next' ? [4, 4] : [])] : [4, 4, 4];
    const input = source(data, { lengths, reuse: true, poisonNext: header ? 1 : undefined });
    const host = hostFor(contracts, { 'input.csv': { utf8: 'a,b\n0,1\n2,3\n' } }); if (!borrowed) host.fs.readStream = () => input;
    const args = header ? ['headers', '-j'] : job.stop === 'satisfied-range' ? ['slice', '-l', '1'] : ['slice', '-L', '1'];
    const record = await invoke(module, contracts, [...args, ...(borrowed ? [] : ['input.csv'])], { host, stdin: input, noHook: job.ownership === 'direct-finally-only' });
    await report({ ...raw(record), producerEvents: input.events }); assert.equal(record.failed, false); assert.equal(record.result.exitCode, 0);
    assert.equal(input.events.filter(event => event === 'return').length, borrowed || job.stop === 'tail-EOF' ? 0 : 1);
    assert.equal(input.events.filter(event => event === 'next').length, header ? 1 : job.stop === 'satisfied-range' ? 2 : 4);
    assert.equal(record.stdout.toString(), header ? 'a\nb\n' : job.stop === 'satisfied-range' ? 'a,b\n0,1\n' : 'a,b\n2,3\n'); return;
  }
  if (job.kind === 'origin') {
    const fs = new api.MemoryFileSystem(); await fs.mkdir('/work'); const shell = new api.Shell({ fs, cwd: '/work' }); const origins = [];
    shell.use(module.xanCommands()); shell.use(async (context, next) => { origins.push(context.stdinIsDefault); await next(); });
    let result; try { result = await shell.exec('xan headers -j', job.origin ? {} : { stdin: '' }); } finally { await shell.dispose(); }
    await report({ result, origins }); assert.deepEqual(origins, [job.origin]); assert.equal(result.stdout, ''); assert.equal(result.exitCode, 0); return;
  }
  if (job.kind === 'parent') {
    const fs = new api.MemoryFileSystem(); const shell = new api.Shell({ fs }); shell.use(module.xanCommands()); const seen = [];
    shell.use(async (context, next) => { seen.push(context.args[0]); await next(); });
    let result; let reason;
    try { result = await shell.exec(job.limitKind === 'commands' ? 'xan select 0 | xan slice -l 1 | xan count' : 'xan count', { stdin: 'h\nx\n', limits: job.limitKind === 'commands' ? { maxCommands: 2 } : { maxOutputBytes: 1 } }); }
    catch (error) { reason = error; } finally { await shell.dispose(); }
    await report({ result, error: reason ? { name: reason.name, message: reason.message, limit: reason.limit } : undefined, seen });
    assert.ok(reason instanceof api.ShellLimitError); assert.equal(reason.limit, job.limitKind === 'commands' ? 'maxCommands' : 'maxOutputBytes'); return;
  }
  if (job.kind === 'invoke-env') {
    const fs = new api.MemoryFileSystem(); const shell = new api.Shell({ fs, env: { KEEP: 'parent' } }); shell.use(module.xanCommands()); const contexts = [];
    shell.use(async (context, next) => { if (context.command === 'xan') contexts.push({ env: { ...context.env }, stdinIsDefault: context.stdinIsDefault }); await next(); });
    shell.commands.register({ name: 'review-invoke', async execute(context) {
      await context.invoke('xan', ['count'], { replaceEnv: true, env: { ONLY: 'child' }, signal: undefined });
      await context.invoke('xan', ['count'], { replaceEnv: true });
      assert.equal(context.env.KEEP, 'parent'); return { exitCode: 0 };
    } });
    let result; try { result = await shell.exec('review-invoke'); } finally { await shell.dispose(); }
    await report({ result, contexts }); assert.equal(result.stdout, '0\n0\n'); assert.deepEqual(contexts.map(context => context.env), [{ ONLY: 'child' }, {}]); assert.ok(contexts.every(context => context.stdinIsDefault)); return;
  }
  if (job.kind === 'backpressure') {
    const gate = deferred(); let writes = 0; let overlapping = false; let active = false; const retained = [];
    const output = { async write(chunk) { overlapping ||= active; active = true; writes++; await gate.promise; retained.push(Buffer.from(chunk)); active = false; } };
    let settled = false; const pending = invoke(module, contracts, ['slice'], { input: 'h\na\n', stdout: output }).then(record => { settled = true; return record; });
    await setImmediate(); const before = { settled, writes }; gate.resolve(); const record = await pending;
    await report({ ...raw(record), before, writes, overlapping, output: Buffer.concat(retained).toString('base64') });
    assert.equal(before.settled, false); assert.equal(before.writes, 1); assert.equal(overlapping, false); assert.equal(record.result.exitCode, 0); assert.equal(Buffer.concat(retained).toString(), 'h\na\n'); return;
  }
  if (job.kind === 'fallback-limit') {
    const record = await invoke(module, contracts, ['slice', 'input.csv', '-o', 'out.csv'], { files: { 'input.csv': { utf8: 'h\nx\nx\n' }, 'out.csv': { utf8: 'original' } }, fs: { noWriteStream: true }, factory: { limits: { maxOutputBytes: 4 } } });
    await report(raw(record)); assert.equal(record.result.exitCode, 1); assert.equal(record.files['out.csv'].toString(), 'original'); assert.equal(record.fsEvents.filter(event => event.method.startsWith('write')).length, 0); return;
  }
  if (job.kind === 'ledger') {
    const exact = job.name === 'maxWork' ? 15 : 64; const limit = exact + job.delta;
    const ledger = job.name === 'maxWork' ? [{ phase: 'argv UTF8 inspection', amount: 5 }, { phase: 'scanner delivered bytes inspected', amount: 2 }, { phase: 'text size', amount: 2 }, { phase: 'encode text size', amount: 2 }, { phase: 'encoded writes', amount: 2 }, { phase: 'managed output delivery', amount: 2 }] : [{ phase: 'scanner slot', capacity: 32 }, { phase: 'count row slot overlapping scanner', capacity: 32 }, { phase: 'row released; output allocation', capacity: 2 }];
    const record = await invoke(module, contracts, ['count'], { input: 'a\n', factory: { limits: { [job.name]: limit } } });
    await report({ ...raw(record), exact, limit, ledger, scope: 'SOURCE_AUDITED_SIMPLE_PATH_NOT_ALL_PATH_LEDGER_OR_DEFAULT_SCALE' });
    assert.equal(record.failed, false); assert.equal(record.result.exitCode, job.delta < 0 ? 1 : 0); if (job.delta >= 0) assert.equal(record.stdout.toString(), '0\n');
    if (job.delta < 0) assert.equal(record.stderr.toString(), `xan count: ${job.name} limit exceeded\n`); return;
  }
  if (job.kind === 'resource') {
    const row = limits.find(row => row.name === job.name); const configured = { ...row, defaultValue: job.limit };
    const spec = generator(configured, job.target, job.name === 'maxSelectorNodes' && job.target % 2 ? 'complement' : 'plain');
    if (spec.reachability.startsWith('NOT_REACHABLE')) { await report({ reachability: spec.reachability, target: job.target, scale: job.scale }); return { status: 'BLOCKED', reason: spec.reachability }; }
    const overrides = Object.fromEntries(limits.map(limit => [limit.name, limit.hardCeiling])); overrides[job.name] = job.limit;
    const inputHash = digestSink(); let chunks = 0; const stdin = { async *[Symbol.asyncIterator]() { for await (const chunk of spec.input()) { chunks++; await inputHash.write(chunk); yield chunk; } } };
    const output = digestSink(); const host = hostFor(contracts, Object.fromEntries(spec.files.map(file => [file.name, { utf8: file.utf8 }])));
    const controller = new AbortController(); const deadlineReason = Object.freeze({ reviewDeadline: true });
    const timer = setTimeout(() => controller.abort(deadlineReason), 35000);
    let record;
    try { record = await invoke(module, contracts, spec.argv, { host, stdin, stdout: output, factory: { limits: overrides }, controller }); }
    finally { clearTimeout(timer); }
    const stdout = output.finish(); const input = inputHash.finish(); await report({ ...raw(record), stdout, input, chunks, target: job.target, configuredLimit: job.limit, argv: spec.argv, independent: spec.independent, siblingLimits: overrides, scale: job.scale });
    if (record.reason === deadlineReason) return { status: 'BLOCKED', reason: 'ACTUAL_RESOURCE_ATTEMPT_INCOMPLETE_35_SECOND_BOUND; cooperative cleanup settled; partial raw retained, not a pass' };
    assert.equal(record.failed, false); assert.equal(record.result.exitCode, job.target > job.limit ? 1 : 0);
    if (job.target > job.limit) { const diagnostic = `xan ${spec.argv[0]}: ${job.name} limit exceeded\n`; assert.equal(record.stderr.toString(), Buffer.byteLength(diagnostic) <= overrides.maxOutputBytes - stdout.bytes ? diagnostic : ''); }
    if (job.target <= job.limit && spec.expectedStdout) { const expected = digestSink(); await expected.write(Buffer.from(spec.expectedStdout)); assert.deepEqual(stdout, expected.finish()); }
    return;
  }
  throw Error(`NO_ACTUAL_BRIDGE:${job.kind}`);
}
