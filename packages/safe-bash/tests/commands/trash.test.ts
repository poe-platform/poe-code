import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, createMountFileSystem, createDeviceFileSystem } from "../../../safe-fs/src/core.js";
import { Shell } from "../../src/shell/index.js";
import { baseAgentCommands } from "../../src/registry-entry.js";

for (const mounted of [false, true]) test(`atomic Trash through ${mounted ? 'mount/device' : 'direct'} shell`, async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir('/folder');
  await backing.writeFile('/folder/note', new TextEncoder().encode('saved'));
  await backing.writeFile('/denied', new Uint8Array([1]));
  const puts: string[] = [];
  const backend = new Proxy(backing, {get(target, key) {
    if (key === 'capabilities') return {...target.capabilities, atomicTrash: true};
    if (key === 'trashPut') return async (path: string) => {puts.push(path); if (path === '/denied') throw new Error('EACCES'); await target.rename(path, '/saved');};
    if (key === 'trashList') return async () => [{item: 'one', path: '/folder', deletionDate: '2026-11-25T12:00:00'}];
    if (key === 'trashRestore') return async (_path: string, item: string) => {assert.equal(item, 'one'); await target.rename('/saved', '/folder');};
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const cwd = mounted ? '/org' : '/';
  const fs = mounted ? createDeviceFileSystem(createMountFileSystem({root: createMemoryFileSystem(), mounts: {'/org': backend}})) : backend;
  const shell = new Shell({fs, cwd}).use(baseAgentCommands());
  try {
    assert.equal((await shell.exec('rm folder')).exitCode, 1);
    assert.equal((await shell.exec('rm -f missing')).exitCode, 0);
    const removed = await shell.exec("printf 'y\\n' | rm -ri folder; trash-list");
    assert.equal(removed.exitCode, 0, removed.stderr);
    assert.deepEqual(puts, ['/folder']);
    assert.match(removed.stdout, /one/);
    const restored = await shell.exec('trash-restore one; cat folder/note');
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, 'saved');
    assert.equal((await shell.exec('trash-put folder')).exitCode, 0);
    const failed = await shell.exec('rm -f denied');
    assert.equal(failed.exitCode, 1, failed.stderr);
    assert.equal((await backing.readFile('/denied'))[0], 1);
  } finally {await shell.dispose();}
});

test('trash restore selects a mount without mutating its root and rejects read-only mounts', async () => {
  const backing = createMemoryFileSystem();
  let readOnly = false, restored = 0;
  const backend = new Proxy(backing, {get(target, key) {
    if (key === 'capabilities') return {...target.capabilities, atomicTrash: true, readOnly};
    if (key === 'trashRestore') return async (path: string) => {assert.equal(path, '/'); restored++;};
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const fs = createMountFileSystem({root: createMemoryFileSystem(), mounts: {'/org': backend}});
  await fs.trashRestore!('/org', 'item');
  assert.equal(restored, 1);
  readOnly = true;
  await assert.rejects(fs.trashRestore!('/org', 'item'), {code: 'EROFS'});
  assert.equal(restored, 1);
});
