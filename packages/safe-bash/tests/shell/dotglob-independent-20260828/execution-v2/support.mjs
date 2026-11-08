import assert from 'node:assert/strict';
import { readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, exactResult, commandCase } from '../execution-prep-v1/cohorts.mjs';
import { cases, quote } from '../execution-prep-v1/plan.mjs';

export { assert, fixture, exactResult, commandCase, cases, quote };
export const encode = value => new TextEncoder().encode(value);
export const turn = () => new Promise(resolve => setImmediate(resolve));
export function deferred(resources) {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  resources.release(() => resolve());
  return { promise, resolve };
}
export async function outcome(promise) {
  try { return { kind: 'result', value: await promise }; }
  catch (reason) { return { kind: 'throw', reason }; }
}
export function record(value) {
  if (value.kind === 'result') return { kind: 'result', exitCode: value.value.exitCode, stdout: value.value.stdout, stderr: value.value.stderr };
  return { kind: 'throw', reason: String(value.reason), name: value.reason?.name, limit: value.reason?.limit, code: value.reason?.code };
}
export function expectLimit(api, captured, limit) {
  assert.equal(captured.kind, 'throw'); assert.ok(captured.reason instanceof api.ShellLimitError);
  assert.equal(captured.reason.limit, limit);
}
export async function create(api, resources, options = {}) {
  const current = await fixture(api, resources, options.fixture ?? 'basic', options.files ?? {}, options.shell ?? {});
  current.calls = [];
  current.shell.register({ name: 'capture', execute(context) { current.calls.push([...context.args]); return { exitCode: 0 }; } });
  return current;
}
export function watchBuiltin(Runtime, resources, name = 'shopt') {
  const original = Runtime.prototype.builtin;
  const records = [];
  Runtime.prototype.builtin = async function(context, state, ...rest) {
    const item = { runtime: this, context, state, args: [...context.args], before: { ...state } };
    if (context.command === name) records.push(item);
    try { const status = await original.call(this, context, state, ...rest); item.status = status; return status; }
    finally { item.after = { ...state }; }
  };
  resources.restore(() => { Runtime.prototype.builtin = original; });
  return {
    records,
    async query(item = records.at(-1)) {
      assert.ok(item, 'actual builtin mechanism reached');
      const quiet = { async write() { assert.fail('quiet observation unexpectedly writes'); } };
      const code = await original.call(item.runtime, { ...item.context, command: 'shopt', args: ['-q', 'dotglob'], stdout: quiet, stderr: quiet }, item.state, new Map());
      assert.ok(code === 0 || code === 1, 'actual shopt query status');
      return code;
    },
    retainedEnabled() {
      const setter = records.find(item => item.status === 0 && item.args.includes('-s') && item.args.includes('dotglob'));
      assert.ok(setter, 'actual successful set observed');
      const changed = Object.keys(setter.after).filter(key => setter.before[key] === false && setter.after[key] === true);
      assert.equal(changed.length, 1, 'single private boolean change; ambiguity is instrumentation failure, not learned expected output');
      assert.equal(setter.state[changed[0]], true, 'enabled boolean not rolled back after later failure');
      return { field: changed[0], enabled: setter.state[changed[0]] };
    },
    enabledState(item = records.at(-1)) {
      const setter = records.find(value => value.status === 0 && value.args.includes('-s') && value.args.includes('dotglob'));
      assert.ok(setter); assert.ok(item);
      const changed = Object.keys(setter.after).filter(key => setter.before[key] === false && setter.after[key] === true);
      assert.equal(changed.length, 1);
      assert.equal(typeof item.state[changed[0]], 'boolean');
      return item.state[changed[0]];
    },
  };
}
export function mergeEvents(events) {
  const merged = [];
  for (const [channel, text] of events) {
    if (merged.at(-1)?.[0] === channel) merged.at(-1)[1] += text;
    else merged.push([channel, text]);
  }
  return merged;
}
export async function patternFixture(api, resources, variant = 'visible') {
  const fs = new api.MemoryFileSystem();
  await fs.mkdir('/g');
  const names = variant === 'single' ? ['a'.repeat(64)] : variant === 'hidden' ? ['a'.repeat(64), '.' + 'a'.repeat(63)] : ['a'.repeat(64), 'a'.repeat(63) + 'c'];
  for (const name of names) await fs.writeFile('/g/' + name, new Uint8Array());
  const shell = resources.own(new api.Shell({ fs, cwd: '/g', env: { LC_ALL: 'C', TZ: 'UTC' }, limits: { maxOutputBytes: 32768, maxCommands: 128, maxExpansionFields: 128, maxExpansionBytes: 600, maxLoopIterations: 16, maxSubstitutionDepth: 8 } }));
  const calls = [];
  shell.register({ name: 'capture', execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
  return { fs, shell, calls, names, pattern: '*' + 'a'.repeat(32) + 'b' };
}
export async function patternAbort(api, Runtime, resources, manifest, prefix = '') {
  const current = await patternFixture(api, resources);
  const controller = new AbortController(), reason = { marker: 'actual-pattern-checkpoint' };
  const immediate = globalThis.setImmediate, glob = Runtime.prototype.glob;
  let active = 0, hits = 0;
  Runtime.prototype.glob = async function(...args) { active++; try { return await glob.apply(this, args); } finally { active--; } };
  globalThis.setImmediate = function(callback, ...args) {
    if (active && new Error().stack?.includes(manifest.patternModule + ':')) { hits++; controller.abort(reason); }
    return immediate(callback, ...args);
  };
  resources.restore(() => { globalThis.setImmediate = immediate; Runtime.prototype.glob = glob; });
  const captured = await outcome(current.shell.exec(prefix + 'capture ' + current.pattern, { signal: controller.signal }));
  assert.equal(captured.kind, 'throw'); assert.ok(Object.is(captured.reason, reason));
  assert.ok(hits > 0, 'real bound pattern checkpoint activated'); assert.deepEqual(current.calls, []);
  return { hits, names: current.names, pattern: current.pattern, reasonIdentity: true };
}
export async function realFixture(api, resources, manifest, label) {
  assert.match(label, /^[a-z0-9-]+$/u);
  const owned = join(manifest.scratchRoot, label), root = join(owned, 'root');
  assert.ok(lstatSync(root).isDirectory(), 'parent-prepared owned RealFS fixture');
  assert.equal(readlinkSync(join(root, 'escape')), '../outside.txt');
  assert.equal(readFileSync(join(owned, 'outside.txt'), 'utf8'), 'owned-outside-sentinel');
  const fs = new api.RealFileSystem({ root });
  await fs.mkdir('/g');
  for (const name of ['visible', '.hidden', '..keep']) await fs.writeFile('/g/' + name, encode(name));
  const shell = resources.own(new api.Shell({ fs, cwd: '/g', env: { LC_ALL: 'C', TZ: 'UTC' }, limits: { maxCommands: 128, maxOutputBytes: 32768, maxExpansionFields: 128, maxExpansionBytes: 8192 } }));
  const calls = [];
  shell.register({ name: 'capture', execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
  const captured = await outcome(fs.readFile('/escape'));
  assert.equal(captured.kind, 'throw'); assert.ok(captured.reason instanceof api.FsError);
  assert.equal(captured.reason.code, 'EACCES');
  assert.equal(readFileSync(join(owned, 'outside.txt'), 'utf8'), 'owned-outside-sentinel');
  return { fs, shell, calls, refusal: record(captured) };
}
