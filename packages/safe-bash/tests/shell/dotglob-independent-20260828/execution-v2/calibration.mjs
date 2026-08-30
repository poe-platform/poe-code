import { assert, create, exactResult, encode, outcome, record, patternFixture, patternAbort, deferred, turn, realFixture } from './support.mjs';

export const calibrationIds = [
  'B01-public', 'B02-absent-shopt', 'B03-off-glob', 'B04-old-dot-entries', 'B05-file-preflight',
  'B06-entry-routes', 'B07-stdout-error', 'B08-stderr-error', 'B09-pattern34-single', 'B10-pattern64-single',
  'B11-pattern600-two', 'B12-pattern34-two', 'B13-pattern-caller-abort', 'B14-preabort',
  'B15-cleanup-budget-caller', 'B16-shared-command-limit', 'B17-source-limit', 'B18-no-input',
  'B19-provider-errors', 'B20-realfs', 'B21-source-line', 'B22-unawaited-colon',
];
export async function calibrate(id, resources, { api, Runtime, manifest, binding }) {
  if (id === 'B01-public') {
    assert.deepEqual(api.createAgentCommands().map(command => command.name).sort(), binding.defaultNames);
    return { defaults: 77, api: ['Shell', 'MemoryFileSystem', 'RealFileSystem', 'agentCommands'].map(name => [name, typeof api[name]]) };
  }
  if (id.startsWith('B09') || id.startsWith('B10') || id.startsWith('B11') || id.startsWith('B12')) {
    const single = id.includes('single'), bytes = Number(/pattern(\d+)/u.exec(id)[1]);
    const current = await patternFixture(api, resources, single ? 'single' : 'visible');
    const result = await outcome(current.shell.exec('capture ' + current.pattern, { limits: { maxExpansionBytes: bytes } }));
    return { variant: id, ...record(result), calls: current.calls };
  }
  if (id === 'B13-pattern-caller-abort') return patternAbort(api, Runtime, resources, manifest);
  if (id === 'B20-realfs') {
    const current = await realFixture(api, resources, manifest, 'baseline');
    const result = await current.shell.exec('capture *; capture .*; capture ..');
    return { ...record({ kind: 'result', value: result }), calls: current.calls, refusal: current.refusal };
  }
  const current = await create(api, resources, { fixture: id === 'B04-old-dot-entries' ? 'dot-entries' : 'basic' });
  const { shell, fs } = current;
  if (id === 'B02-absent-shopt') {
    const result = await shell.exec('shopt -q dotglob');
    assert.equal(result.exitCode, 127);
    return { baselineGap: 'shopt absent; not a new product failure', ...record({ kind: 'result', value: result }) };
  }
  if (id === 'B03-off-glob' || id === 'B04-old-dot-entries') {
    const result = await shell.exec('capture *; capture .*');
    return { ...record({ kind: 'result', value: result }), calls: current.calls, qualification: id === 'B04-old-dot-entries' ? 'old wildcard dot-entry behavior; mandatory DOTGLOB off-state correction remains frozen' : 'existing off-state' };
  }
  if (id === 'B05-file-preflight') {
    await fs.writeFile('/g/bad', encode('touch /g/marker\nif'));
    const result = await shell.exec('bash /g/bad');
    assert.equal(result.exitCode, 2); assert.equal((await outcome(fs.stat('/g/marker'))).kind, 'throw');
    return record({ kind: 'result', value: result });
  }
  if (id === 'B06-entry-routes') {
    await fs.writeFile('/g/file', encode('printf route'));
    await fs.writeFile('/g/bash-file', encode('#!/bin/bash\nprintf route'));
    await fs.writeFile('/g/sh-file', encode('#!/bin/sh\nprintf route'));
    await fs.chmod('/g/bash-file', 0o755); await fs.chmod('/g/sh-file', 0o755);
    const rows = [];
    for (const [script, options] of [["bash -c 'printf route'", {}], ["sh -c 'printf route'", {}], ['bash -s', { stdin: 'printf route' }], ['bash /g/file', {}], ['/g/bash-file', {}], ['/g/sh-file', {}]]) rows.push({ script, ...record(await outcome(shell.exec(script, options))) });
    return { rows, qualification: '/bin/sh original S13 remains qualified separately; no new support claim' };
  }
  if (id === 'B07-stdout-error' || id === 'B08-stderr-error') {
    const reason = new Error(id), events = [];
    const channel = id === 'B07-stdout-error' ? 'stdout' : 'stderr';
    let writes = 0;
    const result = await outcome(shell.exec(channel === 'stdout' ? 'readonly a=one b=two; readonly; printf after' : 'readonly bad-name a=one; printf after', {
      [channel]: { async write(chunk) { events.push(Buffer.from(chunk).toString()); if (++writes === 1) throw reason; } },
    }));
    return { ...record(result), exactReason: result.kind === 'throw' && result.reason === reason, events };
  }
  if (id === 'B14-preabort') {
    const rows = [];
    for (const reason of [false, Symbol('baseline')]) {
      const controller = new AbortController(); controller.abort(reason);
      const result = await outcome(shell.exec('capture *', { signal: controller.signal }));
      assert.equal(result.kind, 'throw'); assert.ok(Object.is(result.reason, reason));
      rows.push({ reason: String(reason), exact: true });
    }
    assert.deepEqual(current.calls, []); return rows;
  }
  if (id === 'B15-cleanup-budget-caller') {
    const rows = [];
    for (const mode of ['cleanup', 'budget', 'caller']) {
      const target = await create(api, resources), controller = new AbortController(), cleanup = new Error('baseline-cleanup');
      let closed = 0;
      target.shell.register({ name: 'owned', async execute(context) {
        context.registerCleanup(async () => { closed++; if (mode === 'caller') controller.abort(false); throw cleanup; });
        if (mode !== 'cleanup') return context.invoke(':', []);
        return { exitCode: 0 };
      } });
      const captured = await outcome(target.shell.exec('owned', { signal: controller.signal, limits: { maxCommands: 1 } }));
      rows.push({ mode, ...record(captured), cleanupIdentity: captured.kind === 'throw' && captured.reason === cleanup, callerIdentity: captured.kind === 'throw' && Object.is(captured.reason, false), closed });
    }
    return rows;
  }
  if (id === 'B16-shared-command-limit') {
    shell.register({ name: 'relay', async execute(context) { try { return await context.invoke(':', []); } catch { return { exitCode: 0 }; } } });
    return record(await outcome(shell.exec('relay', { limits: { maxCommands: 1 } })));
  }
  if (id === 'B17-source-limit') {
    const script = "eval 'printf x'";
    return record(await outcome(shell.exec(script, { limits: { maxSourceBytes: Buffer.byteLength(script) } })));
  }
  if (id === 'B18-no-input') {
    let pulls = 0;
    const stdin = { [Symbol.asyncIterator]() { return { async next() { pulls++; return { done: true }; } }; } };
    const result = await shell.exec(':', { stdin }); assert.equal(pulls, 0);
    return { ...record({ kind: 'result', value: result }), pulls };
  }
  if (id === 'B19-provider-errors') {
    const rows = [];
    for (const method of ['readdir', 'stat']) for (const code of ['ENOENT', 'ENOTDIR', 'EACCES', 'EIO', 'ECANCELED']) {
      const target = await create(api, resources), original = target.fs[method].bind(target.fs);
      target.fs[method] = async (path, options) => { if (path === '/g' && method === 'readdir' || path === '/g/visible' && method === 'stat') throw new api.FsError(code, 'bound-provider', path); return original(path, options); };
      rows.push({ method, code, ...record(await outcome(target.shell.exec('capture visible*'))), calls: target.calls });
    }
    return rows;
  }
  if (id === 'B21-source-line') {
    await fs.writeFile('/g/line.sh', encode('\nreadonly bad-name\n'));
    return record(await outcome(shell.exec('. /g/line.sh')));
  }
  if (id === 'B22-unawaited-colon') {
    let child, retired = 0;
    shell.register({ name: 'owned', execute(context) { context.registerCleanup(() => { retired++; }); child = outcome(context.invoke(':', [])); return { exitCode: 0 }; } });
    const root = await outcome(shell.exec('owned')); const nested = await child;
    return { root: record(root), child: record(nested), retired };
  }
  assert.fail('unimplemented calibration ' + id);
}
