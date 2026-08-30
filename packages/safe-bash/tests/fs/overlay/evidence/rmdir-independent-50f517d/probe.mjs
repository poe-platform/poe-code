import assert from 'node:assert/strict';
import { MemoryFileSystem } from './archive/src/fs/memory/index.ts';
import { createOverlayFileSystem } from './archive/src/fs/overlay/index.ts';
import { FsError } from './archive/src/contracts/errors.ts';

const bytes = new Uint8Array([0, 255, 128, 10]);
const rows = [];
const mutators = new Set(['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'symlink', 'link', 'chmod', 'utimes', 'truncate', 'writeStream']);
const outcome = async action => {
  try { await action(); return { status: 'fulfilled' }; }
  catch (error) {
    assert.ok(error instanceof FsError);
    return { status: 'rejected', code: error.code, syscall: error.syscall, path: error.path, message: error.message };
  }
};
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};
async function snapshot(fs, path = '/') {
  const { atimeMs, ...stat } = await fs.lstat(path);
  if (stat.type === 'file') return { stat, bytes: [...await fs.readFile(path)] };
  const children = {};
  for (const entry of await fs.readdir(path)) children[entry.name] = await snapshot(fs, `${path === '/' ? '' : path}/${entry.name}`);
  return { stat, children };
}
function fixture(upper, lower, hooks = {}) {
  const calls = [];
  const wrap = (backend, layer) => new Proxy(backend, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return async (...args) => {
        if (mutators.has(property)) {
          calls.push({ layer, method: property, path: args[0], recursive: args[1]?.recursive });
          assert.notEqual(layer, 'lower', 'overlay must never mutate lower');
        }
        if (hooks[`${layer}:${property}`]) await hooks[`${layer}:${property}`](...args);
        return value.apply(target, args);
      };
    },
  });
  return { overlay: createOverlayFileSystem({ upper: wrap(upper, 'upper'), lower: wrap(lower, 'lower') }), calls };
}

for (const kind of ['static-lower-only', 'static-preexisting-upper-only', 'static-merged', 'overlay-created-upper', 'hidden-lower-child-unisolated', 'hidden-lower-child-opaque', 'visible-lower-child', 'visible-upper-child']) {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  if (['static-lower-only', 'static-merged', 'hidden-lower-child-unisolated', 'hidden-lower-child-opaque', 'visible-lower-child'].includes(kind)) await lower.mkdir('/d');
  if (['static-preexisting-upper-only', 'static-merged', 'visible-upper-child'].includes(kind)) await upper.mkdir('/d');
  if (kind.startsWith('hidden-lower-child') || kind === 'visible-lower-child') await lower.writeFile('/d/child', bytes);
  if (kind === 'visible-upper-child') await upper.writeFile('/d/child', bytes);
  const { overlay, calls } = fixture(upper, lower);
  if (kind === 'overlay-created-upper') await overlay.mkdir('/d');
  if (kind.startsWith('hidden-lower-child')) await overlay.rm('/d/child');
  if (kind === 'hidden-lower-child-opaque') {
    await overlay.rm('/d', { recursive: false });
    await overlay.mkdir('/d');
  }
  const before = { overlay: await snapshot(overlay), upper: await snapshot(upper), lower: await snapshot(lower) };
  calls.length = 0;
  const result = await outcome(() => overlay.rmdir('/d'));
  const removalCalls = [...calls];
  const after = { overlay: await snapshot(overlay), upper: await snapshot(upper), lower: await snapshot(lower) };
  assert.deepEqual(after.lower, before.lower);
  assert.ok(removalCalls.every(call => call.layer === 'upper' && call.method === 'rmdir'));
  if (result.status === 'rejected') assert.deepEqual(after, before);
  const expected = kind.startsWith('visible-') ? 'ENOTEMPTY' : undefined;
  assert.equal(result.code, expected);
  if (!expected) {
    assert.equal((await outcome(() => overlay.stat('/d'))).code, 'ENOENT');
    const expectedOverlayChildren = { ...before.overlay.children };
    delete expectedOverlayChildren.d;
    assert.deepEqual(after.overlay.children, expectedOverlayChildren);
    const expectedUpperChildren = { ...before.upper.children };
    delete expectedUpperChildren.d;
    assert.deepEqual(after.upper.children, expectedUpperChildren);
    const hadUpper = Object.hasOwn(before.upper.children, 'd');
    assert.deepEqual(removalCalls, hadUpper ? [{ layer: 'upper', method: 'rmdir', path: '/d', recursive: undefined }] : []);
  }
  rows.push({ case: kind, expectedUnderExistingOwnershipPreconditions: kind.startsWith('visible-') ? 'ENOTEMPTY' : 'success', result, removalCalls, before, after });
}

{
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  const { overlay, calls } = fixture(upper, lower);
  await overlay.mkdir('/d');
  calls.length = 0;
  const writer = outcome(() => overlay.writeFile('/d/child', bytes));
  const removal = outcome(() => overlay.rmdir('/d'));
  const results = await Promise.all([writer, removal]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].code, 'ENOTEMPTY');
  assert.deepEqual(await overlay.readFile('/d/child'), bytes);
  rows.push({ case: 'same-instance-writer-queued-before-rmdir', results, childBytes: [...await upper.readFile('/d/child')], backingRmdirCalls: calls.filter(call => call.method === 'rmdir'), calls });
}

{
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  const entered = deferred();
  const release = deferred();
  const events = [];
  const { overlay, calls } = fixture(upper, lower, { 'upper:rmdir': async () => {
    events.push('upper-rmdir-entered'); entered.resolve(); await release.promise; events.push('upper-rmdir-released');
  } });
  await overlay.mkdir('/d');
  calls.length = 0;
  const removal = outcome(() => overlay.rmdir('/d'));
  await entered.promise;
  events.push('same-instance-child-write-queued');
  const writer = outcome(() => overlay.writeFile('/d/child', bytes));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call.method), ['rmdir']);
  release.resolve();
  const results = await Promise.all([removal, writer]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].code, 'ENOENT');
  assert.equal((await outcome(() => overlay.stat('/d'))).code, 'ENOENT');
  rows.push({ case: 'same-instance-writer-queued-after-rmdir-holds-queue', results, events, calls, noChildCreatedOrDeleted: true });
}

{
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  await lower.mkdir('/d');
  let injected = false;
  const { overlay, calls } = fixture(upper, lower, { 'lower:readdir': async path => {
    if (path === '/d' && !injected) { injected = true; await lower.writeFile('/d/external', bytes); }
  } });
  const result = await outcome(() => overlay.rmdir('/d'));
  assert.equal(result.code, 'ENOTEMPTY');
  assert.deepEqual(await overlay.readFile('/d/external'), bytes);
  rows.push({ case: 'external-lower-write-outside-documented-precondition', outsideContract: true, result, calls, preservedBytes: [...await lower.readFile('/d/external')] });
}

console.log(JSON.stringify({ pin: '50f517d4e28281ccba8c7580d017fe65a4bf8e20', observations: rows.length, rows }, null, 2));
