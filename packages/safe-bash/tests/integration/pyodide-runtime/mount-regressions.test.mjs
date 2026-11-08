import { createReplySerializer } from './stat-identity.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { MemoryFileSystem } from '../../../../safe-fs/src/fs/memory/index.ts';
import { ReadOnlyFileSystem } from '../../../../safe-fs/src/fs/readonly/index.ts';
import { MountFileSystem } from '../../../../safe-fs/src/fs/mount/index.ts';
import { scopeFileSystem } from '../../../../safe-fs/src/fs/scoped.ts';
import { FsError } from '../../../../safe-fs/src/contracts/errors.ts';
import { withFileSystemQuota } from '../../../../safe-fs/src/fs/quota/index.ts';

// These tests intentionally assert the full contract against the experimental
// mount. A failure is architecture evidence, not a waived production test.
async function run(context, script, afterOperation, configure) {
  const serialize = createReplySerializer();
  let fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.mkdir('/tmp');
  fs = await configure?.(fs) ?? fs;
  const shared = new SharedArrayBuffer(1024 * 1024);
  const control = new Int32Array(shared, 0, 2);
  const bytes = new Uint8Array(shared, 8);
  const handles = new Map();
  let id = 0;
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { shared, script } });
  context.after(async () => {
    await worker.terminate();
    await Promise.all([...handles.values()].map(handle => handle.close()));
  });
  worker.on('message', async ({ op, args }) => {
    if (op === 'done') return;
    let result, failed = false;
    try {
      if (op === 'open') { const handle = await fs.open(...args); result = ++id; handles.set(id, handle); }
      else if (op === 'read') {
        const buffer = new Uint8Array(args[1]);
        const count = await handles.get(args[0]).read(buffer, args[2]);
        result = [...buffer.subarray(0, count)];
      } else if (op === 'write') result = await handles.get(args[0]).write(Uint8Array.from(args[1]), args[2]);
      else if (op === 'sync') result = await handles.get(args[0]).sync(args[1]);
    else if (op === 'fstat') result = await handles.get(args[0]).stat();
      else if (op === 'ftruncate') result = await handles.get(args[0]).truncate(args[1]);
      else if (op === 'close') { await handles.get(args[0]).close(); handles.delete(args[0]); }
      else { if (op === 'writeFile') args[1] = Uint8Array.from(args[1]); result = await fs[op](...args); }
      await afterOperation?.(fs, op, args);
    } catch (error) { failed = true; result = { code: error.code, message: error.message }; }
    const serialized = new TextEncoder().encode(serialize(result));
    assert.ok(serialized.length <= bytes.length);
    bytes.set(serialized);
    Atomics.store(control, 1, serialized.length);
    Atomics.store(control, 0, failed ? 2 : 1);
    Atomics.notify(control, 0);
  });
  await new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', message => { if (message.op === 'done') resolve(); });
  });
  return fs;
}

test('mount retains fstat identity after pathname is replaced', { timeout: 15000 }, async context => {
  await run(context, `import os, pathlib\nf = open('/work/original', 'w+b')\nf.write(b'old'); f.flush()\nos.unlink('/work/original')\npathlib.Path('/work/original').write_bytes(b'replacement')\nassert os.fstat(f.fileno()).st_size == 3, 'fstat followed replacement pathname'\nf.close()\n`);
});

test('read-only canonical wrapper rejects Python writes without changing content', { timeout: 15000 }, async context => {
  const fs = await run(context, `import pathlib\np = pathlib.Path('/work/kept')\nassert p.read_bytes() == b'original'\ntry:\n p.write_bytes(b'changed')\nexcept OSError as e:\n assert e.errno == 69\nelse:\n raise AssertionError('readonly write accepted')\n`, undefined, async fs => {
    await fs.writeFile('/work/kept', new TextEncoder().encode('original'));
    return new ReadOnlyFileSystem(fs);
  });
  assert.equal(new TextDecoder().decode(await fs.readFile('/work/kept')), 'original');
});

test('Python writes honor canonical memory byte quota', { timeout: 15000 }, async context => {
  const fs = await run(context, `import os\nf = os.open('/work/quota', os.O_CREAT | os.O_WRONLY)\nassert os.write(f, b'abcd') == 4\ntry:\n os.write(f, b'e')\nexcept OSError:\n pass\nelse:\n raise AssertionError('memory quota bypassed')\nos.close(f)\n`, undefined, async () => {
    const limited = new MemoryFileSystem({ maxBytes: 4 });
    await limited.mkdir('/work');
    return limited;
  });
  assert.equal(new TextDecoder().decode(await fs.readFile('/work/quota')), 'abcd');
});

test('Python operations use nested canonical mounts', { timeout: 15000 }, async context => {
  const mounted = new MemoryFileSystem();
  await run(context, `import pathlib\np = pathlib.Path('/work/mounted/shared'); p.write_bytes(b'mounted')\nassert p.read_bytes() == b'mounted'\n`, undefined, async fs => new MountFileSystem({ root: fs, mounts: { '/work/mounted': mounted } }));
  assert.equal(new TextDecoder().decode(await mounted.readFile('/shared')), 'mounted');
});

test('Python filesystem calls consume the canonical scoped operation budget', { timeout: 15000 }, async context => {
  let operations = 0;
  await run(context, `import os\nfor i in range(100):\n try:\n  os.stat('/work')\n except OSError:\n  break\nelse:\n raise AssertionError('operation budget bypassed')\n`, undefined, async fs => scopeFileSystem(fs, () => {
    if (++operations > 12) throw new FsError('EFBIG');
  }, new AbortController().signal));
  assert.equal(operations, 13);
});

test('operation budget refusal of a truncating open preserves canonical content', { timeout: 15000 }, async context => {
  let admitted = true;
  let original;
  await run(context, `import os\nos.close(os.open('/work/kept', os.O_RDONLY))\ntry:\n open('/work/kept', 'wb')\nexcept OSError:\n pass\nelse:\n raise AssertionError('exhausted budget admitted open')\n`, async (_fs, op) => {
    if (op === 'close') admitted = false;
  }, async fs => {
    original = fs;
    await fs.writeFile('/work/kept', new TextEncoder().encode('original'));
    return scopeFileSystem(fs, () => { if (!admitted) throw new FsError('EFBIG'); }, new AbortController().signal);
  });
  assert.equal(new TextDecoder().decode(await original.readFile('/work/kept')), 'original');
});

test('canonical quota wrapper refuses descriptor open without a bypass or truncation', { timeout: 15000 }, async context => {
  let original;
  await run(context, `try:\n open('/work/kept', 'wb')\nexcept OSError as e:\n assert e.errno == 138\nelse:\n raise AssertionError('quota descriptor refusal bypassed')\n`, undefined, async fs => {
    original = fs;
    await fs.writeFile('/work/kept', new TextEncoder().encode('original'));
    const quota = withFileSystemQuota(fs, { maxBytes: 100 });
    assert.equal(quota.capabilities.open, false);
    return quota;
  });
  assert.equal(new TextDecoder().decode(await original.readFile('/work/kept')), 'original');
});

test('distinct mounted identity scopes do not alias in Python samefile', { timeout: 15000 }, async context => {
  const left = new MemoryFileSystem();
  const right = new MemoryFileSystem();
  await left.writeFile('/file', Uint8Array.of(1));
  await right.writeFile('/file', Uint8Array.of(2));
  const a = await left.stat('/file');
  const b = await right.stat('/file');
  assert.equal(a.dev, b.dev);
  assert.equal(a.ino, b.ino);
  assert.notEqual(a.identityScope, b.identityScope);
  await run(context, `import os\nassert not os.path.samefile('/work/left/file', '/work/right/file'), 'distinct identity scopes collapsed'\n`, undefined,
    async fs => new MountFileSystem({ root: fs, mounts: { '/work/left': left, '/work/right': right } }));
});

test('mount ftruncate modifies the retained object after pathname is replaced', { timeout: 15000 }, async context => {
  await run(context, `import os, pathlib\nf = open('/work/original', 'w+b')\nf.write(b'old'); f.flush()\nos.unlink('/work/original')\npathlib.Path('/work/original').write_bytes(b'replacement')\nos.ftruncate(f.fileno(), 1)\nf.seek(0)\nassert f.read() == b'o', 'ftruncate did not resize retained object'\nassert pathlib.Path('/work/original').read_bytes() == b'replacement', 'ftruncate corrupted replacement'\nf.close()\n`);
});

test('mount append writes preserve append semantics despite preceding seek', { timeout: 15000 }, async context => {
  await run(context, `import pathlib\np = pathlib.Path('/work/append'); p.write_bytes(b'abc')\nwith p.open('a+b') as f:\n f.seek(0); f.write(b'd'); f.flush()\n assert f.tell() == 4\nassert p.read_bytes() == b'abcd'\n`);
});

test('Python utime preserves distinct access and modification times on the canonical file', { timeout: 15000 }, async context => {
  const fs = await run(context, `import os, pathlib
p = pathlib.Path('/work/archive timestamp ü'); p.write_bytes(b'content')
os.utime(p, (1600000000, 1700000000))
s = p.stat()
assert s.st_atime == 1600000000, s.st_atime
assert s.st_mtime == 1700000000, s.st_mtime
`);
  const stat = await fs.stat('/work/archive timestamp ü');
  assert.equal(stat.atimeMs, 1600000000000);
  assert.equal(stat.mtimeMs, 1700000000000);
});

test('absolute symlink targets stay in the canonical filesystem', { timeout: 15000 }, async context => {
  const fs = await run(context, `import os, pathlib\nos.symlink('/tmp', '/work/link')\npathlib.Path('/work/link/shared').write_bytes(b'canonical')\n`);
  assert.equal(new TextDecoder().decode(await fs.readFile('/tmp/shared')), 'canonical');
});

test('mount revalidates cached node type after another filesystem user replaces the entry', { timeout: 15000 }, async context => {
  await run(context, `import os, pathlib\np = pathlib.Path('/work/type'); p.write_bytes(b'file'); assert p.is_file()\npathlib.Path('/work/trigger').write_bytes(b'go')\nassert os.listdir('/work/type') == []\n`, async (fs, op, args) => {
    if (op === 'open' && args[0] === '/work/trigger') {
      await fs.rm('/work/type');
      await fs.mkdir('/work/type');
    }
  });
});


test('canonical filesystem errno codes reach Python unchanged', { timeout: 15000 }, async context => {
  await run(context, `import errno, os
for code in ['EAGAIN', 'EBADF', 'EBUSY', 'ECANCELED', 'EFBIG', 'EINTR', 'EINVAL', 'EIO', 'ELOOP', 'EMFILE', 'ENAMETOOLONG', 'ENFILE', 'ENOMEM', 'ENOSPC', 'ENOSYS', 'EPERM', 'EPIPE', 'ESPIPE', 'ETIMEDOUT', 'EXDEV']:
 try:
  os.stat('/work/error-' + code)
 except OSError as error:
  assert error.errno == getattr(errno, code), (code, error.errno)
 else:
  raise AssertionError('backend error swallowed: ' + code)
`, undefined, fs => new Proxy(fs, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'stat' || property === 'lstat') return async (path, ...args) => {
        if (path.startsWith('/work/error-')) throw new FsError(path.slice('/work/error-'.length));
        return value.call(target, path, ...args);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
});

test('same canonical storage mounted twice preserves Python identity', { timeout: 15000 }, async context => {
  const shared = new MemoryFileSystem();
  await shared.writeFile('/file', Uint8Array.of(1));
  await shared.link('/file', '/alias');
  await run(context, `import os
assert os.path.samefile('/work/left/file', '/work/right/file')
assert os.path.samefile('/work/left/file', '/work/right/alias')
with open('/work/left/file', 'rb') as f:
 assert os.path.samestat(os.fstat(f.fileno()), os.stat('/work/right/alias'))
`, undefined, fs => new MountFileSystem({ root: fs, mounts: { '/work/left': shared, '/work/right': shared } }));
});

test('exclusive creation refuses existing files and dangling symlinks without mutation', { timeout: 15000 }, async context => {
  const fs = await run(context, `import errno, os, pathlib
pathlib.Path('/work/existing').write_bytes(b'kept')
os.symlink('/work/absent', '/work/dangling')
for path in ['/work/existing', '/work/dangling']:
 try:
  open(path, 'xb')
 except FileExistsError:
  pass
 else:
  raise AssertionError('exclusive creation overwrote ' + path)
assert pathlib.Path('/work/existing').read_bytes() == b'kept'
assert not pathlib.Path('/work/absent').exists()
`);
  assert.equal(new TextDecoder().decode(await fs.readFile('/work/existing')), 'kept');
});

test('exclusive nofollow creation accepts new files and refuses every existing entry', { timeout: 15000 }, async context => {
  await run(context, `import errno, os, pathlib
base = pathlib.Path('/work/exclusive ü'); base.mkdir()
(base / 'kept').write_bytes(b'original')
(base / 'directory').mkdir()
os.symlink(str(base / 'absent'), str(base / 'dangling'))
os.symlink(str(base / 'directory'), str(base / 'directory link'))
flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
for name in ['kept', 'directory', 'dangling', 'directory link']:
 try:
  os.close(os.open(base / name, flags, 0o600))
 except OSError as error:
  assert error.errno == errno.EEXIST, (name, error.errno)
 else:
  raise AssertionError('exclusive creation accepted existing entry: ' + name)
fd = os.open(base / 'fresh', flags, 0o600)
os.write(fd, b'created'); os.close(fd)
assert (base / 'fresh').read_bytes() == b'created'
assert (base / 'kept').read_bytes() == b'original'
assert not (base / 'absent').exists()
`);
});


test('duplicate Python descriptors share offset and survive closing the original', { timeout: 15000 }, async context => {
  await run(context, `import os, pathlib
pathlib.Path('/work/dup').write_bytes(b'abcdef')
f = os.open('/work/dup', os.O_RDONLY)
g = os.dup(f)
assert os.read(f, 2) == b'ab'
assert os.read(g, 2) == b'cd'
os.close(f)
assert os.read(g, 2) == b'ef'
os.close(g)
`);
});

test('Python fsync respects the canonical descriptor synchronization refusal', { timeout: 15000 }, async context => {
  await run(context, `import errno, os
f = os.open('/work/sync', os.O_CREAT | os.O_WRONLY)
try:
 os.fsync(f)
except OSError as error:
 assert error.errno == errno.ENOTSUP
else:
 raise AssertionError('unsupported durable sync reported success')
os.close(f)
`, undefined, fs => new Proxy(fs, {
    get(target, property) {
      if (property === 'open') return async (...args) => {
        const descriptor = await target.open(...args);
        return new Proxy(descriptor, {
          get(handle, key) {
            if (key === 'capabilities') return { ...handle.capabilities, synchronization: 'none' };
            if (key === 'sync') return async () => { throw new FsError('ENOTSUP'); };
            const method = Reflect.get(handle, key);
            return typeof method === 'function' ? method.bind(handle) : method;
          },
        });
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
});


test('synchronous open refuses unsupported guarantees before truncating canonical bytes', { timeout: 15000 }, async context => {
  const fs = await run(context, `import errno, os, pathlib
p = pathlib.Path('/work/synchronized'); p.write_bytes(b'kept')
for flag in [os.O_SYNC, os.O_DSYNC]:
 try:
  os.open(str(p), os.O_WRONLY | os.O_TRUNC | flag)
 except OSError as error:
  assert error.errno == errno.ENOTSUP
 else:
  raise AssertionError('unsupported synchronization flag accepted')
 assert p.read_bytes() == b'kept'
`);
  assert.equal(new TextDecoder().decode(await fs.readFile('/work/synchronized')), 'kept');
});
