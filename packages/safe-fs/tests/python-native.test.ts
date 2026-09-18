import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createPythonNativeSyscalls } from '../src/python/native.js';
import { MemoryFileSystem } from '../src/fs/memory/index.js';
import { PythonFileSystem } from '../src/python/filesystem.js';

function fixture(dispatch: (request: { op: string; args: unknown[] }) => Promise<unknown>, signal = new AbortController().signal) {
  const memory = new Uint8Array(65536);
  const streams: any[] = [];
  const runtime = {
    HEAPU8: memory,
    FS: {
      streams,
      createStream(stream: any) {
        const fd = Math.max(3, streams.length);
        streams[fd] = { ...stream, fd };
        return streams[fd];
      },
      closeStream(fd: number) { streams[fd] = null; },
    },
  };
  const native = createPythonNativeSyscalls({ runtime, dispatch, cwd: '/work',
    runtimeMount: '/.runtime', maxTransferBytes: 2, signal });
  function text(value: string, pointer = 128) { memory.set(new TextEncoder().encode(value + '\0'), pointer); return pointer; }
  function vector(pointer = 1024, length = 3) { new DataView(memory.buffer).setUint32(512, pointer, true); new DataView(memory.buffer).setUint32(516, length, true); }
  return { ...native, memory, text, vector };
}

test('native open/read uses retained canonical bytes and bounded requests', async () => {
  const backend = new MemoryFileSystem();
  await backend.mkdir('/work');
  await backend.writeFile('/work/input', new Uint8Array([0, 255, 42]));
  const filesystem = new PythonFileSystem(backend, { cwd: '/work', maxTransferBytes: 2 });
  const requests: string[] = [];
  const native = fixture(async request => { requests.push(request.op); await Promise.resolve(); return filesystem.dispatch(request); });
  try {
    const fd = await native.invoke('__syscall_openat', [-100, native.text('input'), 0, 0]);
    assert.ok(fd >= 3);
    await backend.rename('/work/input', '/work/moved');
    native.vector();
    assert.equal(await native.invoke('fd_read', [fd, 512, 1, 600]), 0);
    assert.deepEqual(Array.from(native.memory.slice(1024, 1026)), [0, 255]);
    assert.equal(new DataView(native.memory.buffer).getUint32(600, true), 2);
    assert.equal(await native.invoke('fd_close', [fd]), 0);
    assert.deepEqual(requests, ['open', 'descriptorCapabilities', 'read', 'close']);
  } finally { await filesystem.close(); }
});

test('native errno signs distinguish musl and WASI without leaking backend errors', async () => {
  const native = fixture(async () => { throw Object.assign(new Error('private host detail'), {code:'ENOENT'}); });
  assert.equal(await native.invoke('__syscall_openat', [-100, native.text('absent'), 0, 0]), -44);
  assert.equal(await native.invoke('fd_read', [91, 512, 1, 600]), 8);
  assert.equal(await native.invoke('__syscall_socket', [0, 0, 0]), -52);
});

test('binary native output awaits backpressure and owns each bounded fragment', async () => {
  const writes: number[][] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const native = fixture(async request => {
    assert.equal(request.op, 'stdout');
    writes.push(Array.from(request.args[0] as Uint8Array));
    if (writes.length === 1) await blocked;
  });
  native.vector();
  native.memory.set([0, 255, 42], 1024);
  let completed = false;
  const pending = native.invoke('fd_write', [1, 512, 1, 600]).then(value => { completed = true; return value; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(writes, [[0, 255]]);
  release();
  assert.equal(await pending, 0);
  assert.deepEqual(writes, [[0, 255], [42]]);
  assert.equal(new DataView(native.memory.buffer).getUint32(600, true), 3);
});

test('native bridge never delegates canonical paths or unknown descriptors to MEMFS', async () => {
  const native = fixture(async () => { throw Object.assign(new Error(), { code: 'ENOTSUP' }); });
  assert.equal(await native.invoke('__syscall_stat64', [native.text('/work/input'), 1024]), -138);
  assert.equal(await native.invoke('__syscall_getdents64', [99, 1024, 1024]), -8);
  assert.equal(await native.invoke('fd_close', [99]), 8);
});

test('native seek controls subsequent reads without reopening the path', async () => {
  const backend = new MemoryFileSystem();
  await backend.mkdir('/work');
  await backend.writeFile('/work/input', new Uint8Array([0, 255, 42]));
  const filesystem = new PythonFileSystem(backend, { cwd: '/work', maxTransferBytes: 2 });
  const native = fixture(request => filesystem.dispatch(request));
  try {
    const fd = await native.invoke('__syscall_openat', [-100, native.text('input'), 0, 0]);
    assert.equal(await native.invoke('fd_seek', [fd, 2n, 0, 608]), 0);
    native.vector();
    assert.equal(await native.invoke('fd_read', [fd, 512, 1, 600]), 0);
    assert.equal(native.memory[1024], 42);
    assert.equal(new DataView(native.memory.buffer).getUint32(600, true), 1);
  } finally { await native.close(); await filesystem.close(); }
});

test('retirement closes all native descriptors using serial canonical dispatch', async () => {
  let next = 1;
  let active = false;
  const closed: number[] = [];
  const native = fixture(async request => {
    assert.equal(active, false);
    active = true;
    try {
      await Promise.resolve();
      if (request.op === 'open') return next++;
      if (request.op === 'descriptorCapabilities') return {};
      if (request.op === 'close') closed.push(request.args[0] as number);
    } finally { active = false; }
  });
  await native.invoke('__syscall_openat', [-100, native.text('one'), 0, 0]);
  await native.invoke('__syscall_openat', [-100, native.text('two'), 0, 0]);
  await native.close();
  assert.deepEqual(closed, [1, 2]);
});

test('metadata projection preserves absent allocation data instead of inventing native stat fields', async () => {
  const native = fixture(async request => {
    assert.deepEqual(request, {op:'stat',args:['/work/input']});
    return {type:'file', mode:0o644, size:3, mtimeMs:7};
  });
  const metadata = await native.metadata('input', true);
  assert.equal(metadata.mode,0o100644);
  assert.equal(metadata.size,3);
  assert.equal(metadata.mtimeMs,7);
  assert.equal(metadata.blocks,undefined);
  assert.equal(metadata.ino,undefined);
});

test('closing binary stdio revokes that descriptor without affecting its sibling', async () => {
  const operations: string[] = [];
  const native = fixture(async request => { operations.push(request.op); });
  native.vector();
  assert.equal(await native.invoke('fd_close', [1]), 0);
  assert.equal(await native.invoke('fd_write', [1,512,1,600]), 8);
  assert.equal(await native.invoke('fd_write', [2,512,1,600]), 0);
  assert.equal(await native.invoke('fd_close', [1]), 8);
  assert.deepEqual(operations, ['stderr','stderr']);
});

test('cancellation closes a late native acquisition before returning terminal ECANCELED', async () => {
  const controller = new AbortController();
  const closed: unknown[] = [];
  const native = fixture(async request => {
    if (request.op === 'open') { controller.abort(); return 7; }
    assert.equal(request.op,'close');
    closed.push(request.args[0]);
  }, controller.signal);
  assert.equal(await native.invoke('__syscall_openat',[-100,native.text('late'),0,0]),-11);
  await native.close();
  assert.deepEqual(closed,[7]);
});

test('cancellation never asks libc to retry native I/O with EINTR', async () => {
  const controller = new AbortController();
  const native = fixture(async () => { assert.fail('canceled native I/O reached the backend'); }, controller.signal);
  controller.abort();
  native.vector();
  assert.equal(await native.invoke('fd_read', [0, 512, 1, 600]), 11);
  assert.equal(await native.invoke('fd_write', [1, 512, 1, 600]), 11);
  await native.close();
});

test('metadata participates in native admission and retirement barriers', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {release=resolve;});
  const native = fixture(async () => { await held; return {type:'file', mode:0o644, size:0}; });
  const metadata = native.metadata('input',true);
  assert.equal(await native.invoke('__syscall_getcwd',[1024,1024]),-10);
  let retired = false;
  const retirement = native.close().then(() => {retired=true;});
  await Promise.resolve();
  assert.equal(retired,false);
  release();
  await metadata;
  await retirement;
  assert.equal(retired,true);
});

test('negative descriptors never acquire stderr authority', async () => {
  const native = fixture(async () => { assert.fail('invalid descriptor dispatched'); });
  native.vector();
  assert.equal(await native.invoke('fd_write',[-1,512,1,600]),8);
  assert.equal(await native.invoke('fd_read',[-1,512,1,600]),8);
  assert.equal(await native.invoke('__syscall_ioctl',[-1,0,0]),-8);
});

test('native retirement closes only its invocation on a borrowed filesystem', async () => {
  const backend = new MemoryFileSystem();
  await backend.mkdir('/work');
  await backend.writeFile('/work/input',new Uint8Array([42]));
  const filesystem = new PythonFileSystem(backend,{cwd:'/work'});
  const first = fixture(request => filesystem.dispatch(request));
  const sibling = fixture(request => filesystem.dispatch(request));
  try {
    await first.invoke('__syscall_openat',[-100,first.text('input'),0,0]);
    const fd = await sibling.invoke('__syscall_openat',[-100,sibling.text('input'),0,0]);
    await first.close();
    sibling.vector();
    assert.equal(await sibling.invoke('fd_read',[fd,512,1,600]),0);
    assert.equal(sibling.memory[1024],42);
  } finally { await first.close(); await sibling.close(); await filesystem.close(); }
});

test('native backend cancellation, unsupported operations and timeouts retain errno identity', async () => {
  for (const [code, number] of [['ECANCELED',11],['EOPNOTSUPP',138],['ETIMEDOUT',73]] as const) {
    const native = fixture(async () => { throw {code}; });
    assert.equal(await native.invoke('__syscall_openat',[-100,native.text('input'),0,0]),-number);
  }
});

test('empty metadata paths are not silently changed to cwd', async () => {
  const native = fixture(async () => { assert.fail('empty path reached backend'); });
  await assert.rejects(native.metadata('',true),{code:'ENOENT'});
});

test('an admitted metadata failure cannot bypass descriptor retirement', async () => {
  let reject!: (error: unknown) => void;
  const held = new Promise<void>((_resolve, fail) => {reject=fail;});
  const closed: unknown[] = [];
  const native = fixture(async request => {
    if (request.op === 'open') return 1;
    if (request.op === 'descriptorCapabilities') return {};
    if (request.op === 'stat') return held;
    if (request.op === 'close') closed.push(request.args[0]);
  });
  await native.invoke('__syscall_openat',[-100,native.text('input'),0,0]);
  const metadata = assert.rejects(native.metadata('input',true),{code:'ENOENT'});
  const retirement = native.close();
  reject({code:'ENOENT'});
  await metadata;
  await retirement;
  assert.deepEqual(closed,[1]);
});

test('native read seek needs positioned reads, not an unrelated backend cursor query', async () => {
  const native = fixture(async request => {
    if (request.op === 'open') return 1;
    if (request.op === 'descriptorCapabilities') return {positionedRead:true};
    if (request.op === 'read') { assert.equal(request.args[2],2); return new Uint8Array([42]); }
  });
  const fd = await native.invoke('__syscall_openat',[-100,native.text('input'),0,0]);
  assert.equal(await native.invoke('fd_seek',[fd,2n,0,608]),0);
  native.vector();
  assert.equal(await native.invoke('fd_read',[fd,512,1,600]),0);
  assert.equal(native.memory[1024],42);
  await native.close();
});

test('native append refuses unavailable cursor semantics before any writes', async () => {
  const closed: unknown[] = [];
  const native = fixture(async request => {
    if (request.op === 'open') return 1;
    if (request.op === 'descriptorCapabilities') return {positionedWrite:true};
    assert.equal(request.op,'close'); closed.push(request.args[0]);
  });
  assert.equal(await native.invoke('__syscall_openat',[-100,native.text('output'),1025,0]),-138);
  assert.deepEqual(closed,[1]);
});
