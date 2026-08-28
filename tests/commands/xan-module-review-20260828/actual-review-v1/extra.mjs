import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { mockFS, sink, source, deferred } from '../mocks.mjs';
import { scenarios } from '../preparation-v2/scenarios.mjs';

async function invoke(module, contracts, argv, options = {}) {
  const events = []; const cleanups = []; const controller = options.controller ?? new AbortController();
  const stdout = sink(65536, { retain: true }); const stderr = sink(65536, { retain: true });
  const host = options.host ?? mockFS(options.files ?? {}, { errorFactory: (code, filename) => new contracts.FsError(code, { path: filename }), ...options.fs });
  const input = options.stdin ?? source(Buffer.from(options.input ?? ''), { signal: controller.signal, ...options.source });
  const context = { command: 'xan', args: argv, cwd: '/work', env: { KEEP: 'parent' }, fs: host.fs, signal: controller.signal,
    stdin: input, stdinIsDefault: options.stdinIsDefault ?? false, stdout: options.stdout ?? stdout, stderr,
    ...(options.noHook ? {} : { registerCleanup(callback) { events.push('register'); cleanups.push(callback); options.onRegister?.(callback); } }) };
  let result; let failed = false; let reason;
  try { result = await module.createXanCommand(options.factory).execute(context); }
  catch (error) { failed = true; reason = error; }
  events.push('command-settle');
  const drained = await Promise.allSettled(cleanups.map(callback => callback())); events.push('root-drain');
  return { context, result, failed, reason, closed: drained.every(item => item.status === 'fulfilled'), stdout: stdout.finish().data,
    stderr: stderr.finish().data, events, inputEvents: input.events ?? [], fsEvents: host.events, files: host.snapshot(), callbacks: cleanups.length };
}
function raw(record) {
  return { result: record.result, failed: record.failed, reason: record.reason instanceof Error ? { name: record.reason.name, message: record.reason.message } : record.reason,
    closed: record.closed, stdoutBase64: record.stdout.toString('base64'), stderrBase64: record.stderr.toString('base64'), events: record.events,
    inputEvents: record.inputEvents, fsEvents: record.fsEvents, files: Object.fromEntries(Object.entries(record.files).map(([name, data]) => [name, data.toString('base64')])), callbacks: record.callbacks };
}
export async function runExtra({ job, module, contracts, emit }) {
  if (job.kind === 'factory') {
    const observations = [];
    for (const row of job.limits) {
      assert.equal(module.defaultLimits[row.name], row.defaultValue); assert.equal(module.hardLimits[row.name], row.hardCeiling);
      for (const value of [1, row.hardCeiling - 1, row.hardCeiling]) {
        assert.equal(module.createXanCommand({ limits: { [row.name]: value } }).name, 'xan'); observations.push({ name: row.name, value, accepted: true });
      }
    }
    assert.deepEqual(module.createXanCommands().map(command => command.name), ['xan']); assert.equal(module.xanCommands().name, 'xan-commands');
    for (const options of [null, [], 1, { unknown: true }, { replace: undefined }, { limits: null }, { limits: [] }, { limits: { unknown: 1 } }]) assert.throws(() => module.createXanCommand(options), TypeError);
    const commands = new contracts.CommandRegistry(module.createXanCommands()); const original = commands.get('xan');
    assert.throws(() => module.xanCommands().setup({ commands })); assert.equal(commands.get('xan'), original);
    module.xanCommands({ replace: true }).setup({ commands }); assert.notEqual(commands.get('xan'), original);
    const observation = { hardPositiveConfigurations: observations, singleCommand: true, collisionPreflightAndReplacement: true };
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation }); return { observation };
  }
  if (job.kind === 'loader') {
    const observation = {};
    for (const [label, name] of [['builtin', 'node:child_process'], ['sourceFallback', pathToFileURL(job.fallback).href], ['bareSpecifier', 'virtual-bash']]) {
      try { await import(name); observation[label] = 'UNEXPECTED_ACCEPT'; }
      catch (error) { observation[label] = { name: error.name, code: error.code, message: error.message }; }
    }
    try { process.getBuiltinModule('fs'); observation.ambient = 'UNEXPECTED_ACCEPT'; } catch (error) { observation.ambient = error.message; }
    try { Function('return 17')(); observation.eval = 'UNEXPECTED_ACCEPT'; } catch (error) { observation.eval = error.name; }
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
    for (const name of ['builtin', 'sourceFallback', 'bareSpecifier']) assert.match(observation[name].message, /ACTUAL_LOADER_DENIED|Access to this API has been restricted/);
    assert.match(observation.ambient, /ACTUAL_LOADER_DENIED/); assert.equal(observation.eval, 'EvalError');
    return { observation };
  }
  if (job.kind === 'workflow') {
    const api = await import(pathToFileURL(path.join(job.root, 'dist/index.js')).href);
    const names = api.createAgentCommands().map(command => command.name);
    assert.equal(names.length, 77); assert.equal(new Set(names).size, 77); assert.ok(!names.includes('xan'));
    for (const name of ['createXanCommand', 'createXanCommands', 'xanCommands']) assert.equal(Object.hasOwn(api, name), false);
    assert.equal(api.FsError, contracts.FsError);
    const fs = new api.MemoryFileSystem(); await fs.mkdir('/work', { recursive: true });
    const shell = new api.Shell({ fs, cwd: '/work', env: { KEEP: 'parent' }, limits: { maxOutputBytes: 4096, maxCommands: 3 } });
    const middleware = []; const origins = []; const contexts = [];
    shell.use(async (context, next) => { middleware.push(`${context.args[0]}:before`); origins.push(context.stdinIsDefault); contexts.push({ cwd: context.cwd, env: { ...context.env } }); await next(); middleware.push(`${context.args[0]}:after`); });
    shell.use(module.xanCommands());
    let result; let stageBytes = [];
    try {
      if (job.route === 'pipe') result = await shell.exec('xan select 2,0,2 | xan slice -l 1 | xan count', { stdin: 'left,right,right\nA,B,C\n' });
      else if (job.route === 'files') {
        await fs.writeFile('/work/input.csv', Buffer.from('left,right,right\nA,B,C\n'));
        result = await shell.exec('xan select 2,0,2 input.csv -o first.csv; xan slice -l 1 first.csv -o second.csv; xan count second.csv');
        stageBytes = [Buffer.from(await fs.readFile('/work/first.csv')).toString(), Buffer.from(await fs.readFile('/work/second.csv')).toString()];
      } else {
        const first = await shell.exec('xan h -j', { stdin: 'id,id,\n' });
        const second = await shell.exec('xan headers -j', { stdin: 'id,id,\n' });
        assert.deepEqual([first.stdout, second.stdout], ['id\nid\n\n', 'id\nid\n\n']); result = second;
      }
      const observation = { result, stageBytes, middleware, origins, contexts, defaultNames: names, registryAfterExplicitUse: shell.commands.list().map(command => command.name) };
      await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
      if (job.route !== 'alias-h') assert.equal(result.stdout, '1\n');
      if (job.route === 'files') assert.deepEqual(stageBytes, ['right,left,right\nC,A,C\n', 'right,left,right\nC,A,C\n']);
      for (const command of job.route === 'alias-h' ? ['h', 'headers'] : ['select', 'slice', 'count']) { assert.equal(middleware.filter(value => value === `${command}:before`).length, 1); assert.equal(middleware.filter(value => value === `${command}:after`).length, 1); }
      assert.ok(contexts.every(context => context.cwd === '/work' && context.env.KEEP === 'parent'));
      return { observation };
    } finally { await shell.dispose(); }
  }
  if (job.kind === 'cancellation') {
    const controller = new AbortController(); const reason = job.reasonKind === 'primitive' ? 17 : Object.freeze({ code: 'ENOENT', marker: 'exact-caller' });
    const gate = deferred(); let acquired = 0; let returned = 0;
    if (job.trigger === 'preabort') controller.abort(reason);
    const stdin = { [Symbol.asyncIterator]() { acquired++; return { async next() { controller.abort(reason); return gate.promise; }, async return() { returned++; return { done: true }; } }; } };
    const pending = invoke(module, contracts, ['count'], { controller, stdin });
    let settled = false; pending.then(() => { settled = true; }); await setImmediate(); await setImmediate();
    const beforeRelease = settled;
    gate.reject(new Error('controlled opaque late rejection'));
    const result = await pending; await setImmediate();
    const observation = { ...raw(result), reasonIdentity: Object.is(result.reason, reason), beforeRelease, acquired, returned, trigger: job.trigger };
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
    assert.equal(result.failed, true); assert.equal(result.reason, reason); assert.equal(returned, 0); assert.ok(result.closed);
    assert.equal(acquired, job.trigger === 'preabort' ? 0 : 1);
    if (job.trigger === 'opaque-late-rejection') assert.equal(beforeRelease, true, 'opaque promise is not a public cleanup barrier');
    return { observation, closed: result.closed };
  }
  if (job.kind === 'destination') {
    const local = new AbortController(); local.abort(new Error('destination closed'));
    const controller = new AbortController(); let writes = 0;
    const output = { async write() { writes++; }, ownedOutput: { consumerClosed: local.signal, async write() { writes++; } } };
    const first = await invoke(module, contracts, ['headers', '-j', 'input.csv', '-o', 'out.csv'], { controller, stdout: output, files: { 'input.csv': { utf8: 'complete\n' } } });
    const second = await invoke(module, contracts, ['select', '0::1'], { controller, stdout: output });
    const observation = { file: raw(first), diagnostic: raw(second), contextAborted: controller.signal.aborted, writes };
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
    assert.equal(controller.signal.aborted, false); assert.equal(first.result.exitCode, 0); assert.deepEqual(first.files['out.csv'], Buffer.from('complete\n'));
    assert.equal(second.result.exitCode, 1); assert.ok(second.stderr.length); assert.equal(writes, 0); assert.ok(first.closed && second.closed);
    return { observation };
  }
  if (job.kind === 'alias') {
    const kind = job.aliasKind;
    const initial = { 'input.csv': { utf8: kind === 'partial-space' ? 'ack\n' : 'result\n' }, ...(!['new', 'raced-wx', 'unsupported-wx'].includes(kind) ? { 'out.csv': { utf8: 'original' } } : {}) };
    if (kind === 'missing-input') delete initial['input.csv'];
    const settings = { unknownIdentity: ['unknown', 'invalid-comparison', 'permission'].includes(kind), comparison: kind === 'unknown' ? 'unknown' : kind === 'invalid-comparison' ? 'INVALID' : undefined,
      aliases: kind === 'hardlink' ? { '/work/out.csv': '/work/input.csv' } : undefined,
      links: ['followed-symlink', 'dangling-symlink'].includes(kind) ? { '/work/out.csv': kind === 'followed-symlink' ? '/work/input.csv' : '/work/absent.csv' } : undefined,
      noReadStream: kind === 'missing-readStream', noWriteStream: kind === 'fallback', unsupportedWx: kind === 'unsupported-wx', race: kind === 'raced-wx', failAfterPrefix: kind === 'partial-space' };
    const host = mockFS(initial, { ...settings, errorFactory: (code, filename) => new contracts.FsError(code, { path: filename }) });
    if (kind === 'permission') host.fs.compareEntry = async () => { throw new contracts.FsError('EACCES', { path: '/work/out.csv' }); };
    if (kind === 'readonly') host.fs.writeStream = async () => { throw new contracts.FsError('EROFS', { path: '/work/out.csv' }); };
    const argv = ['headers', '-j', kind === 'borrowed-existing' ? '-' : 'input.csv', '-o', kind === 'same-path' ? 'input.csv' : 'out.csv'];
    const result = await invoke(module, contracts, argv, { host, input: 'result\n' });
    const observation = { ...raw(result), aliasKind: kind, exactFsErrorConstructor: contracts.FsError.name };
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
    assert.ok(result.closed); assert.equal(result.failed, false);
    const successful = ['new', 'distinct-complete', 'fallback'].includes(kind); assert.equal(result.result.exitCode, successful ? 0 : 1);
    assert.deepEqual(result.files['input.csv'], initial['input.csv'] ? Buffer.from(initial['input.csv'].utf8) : undefined);
    assert.equal(result.fsEvents.filter(event => event.method === 'writeFile' || event.method === 'writeStream').filter(event => event.flag === 'w').length <= 1, true);
    if (successful) assert.deepEqual(result.files['out.csv'], Buffer.from('result\n'));
    if (['raced-wx', 'unsupported-wx'].includes(kind)) assert.deepEqual(result.fsEvents.filter(event => event.method.startsWith('write')).map(event => event.flag), ['wx']);
    if (kind === 'raced-wx') assert.deepEqual(result.files['out.csv'], Buffer.from('raced\n'));
    if (['same-path', 'hardlink', 'followed-symlink', 'dangling-symlink', 'unknown', 'borrowed-existing', 'invalid-comparison', 'permission', 'missing-input'].includes(kind)) assert.equal(result.fsEvents.filter(event => event.method.startsWith('write')).length, 0);
    if (kind === 'distinct-complete' || kind === 'hardlink') assert.equal(result.fsEvents.filter(event => event.method === 'compareEntry').length, 0);
    return { observation };
  }
  if (job.kind === 'scenario') {
    const spec = scenarios().find(spec => spec.id === job.scenarioId); assert.ok(spec);
    return { status: 'BLOCKED', observation: { id: spec.id, family: spec.family,
      reason: 'Full prepared scenario receipt not authenticated by a completed actual adapter. Separate real probes are not substituted for every expected lifecycle/authority/capacity field.',
      requiredFields: Object.keys(spec.expected), relatedActualJobs: job.relatedActualJobs, noSyntheticObservations: true } };
  }
  throw new Error(`Unknown actual job ${job.kind}`);
}
