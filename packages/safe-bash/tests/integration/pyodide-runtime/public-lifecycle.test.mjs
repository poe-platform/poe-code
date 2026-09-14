import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, pythonCommands } from 'poe-code/safe-bash';
import { createNodePythonWorker } from 'poe-code/safe-bash/commands/python/node';
import { MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem, withFileSystemQuota } from 'poe-code/safe-fs/core';
import { createWorker, runtimeModuleURL, delayedFileSystem, createOfflineCache } from './public-runtime-fixture.mjs';

const quote = value => "'" + value.split("'").join("'\\''") + "'";
const encode = value => new TextEncoder().encode(value);

test('built public Python canonical immediate/delayed composed authority and bidirectional effects', { timeout: 60000 }, async t => {
  for (const delayed of [false, true]) await t.test(delayed ? 'delayed backend' : 'memory backend', async context => {
    const root = new MemoryFileSystem(), writable = new MemoryFileSystem(), protectedStorage = new MemoryFileSystem();
    await root.mkdir('/work'); await root.mkdir('/tmp');
    await protectedStorage.mkdir('/empty');
    await protectedStorage.writeFile('/kept', encode('host protected'));
    await writable.writeFile('/input', encode('host input'));
    const composed = new MountFileSystem({ root, mounts: {
      '/data': writable,
      '/protected': new ReadOnlyFileSystem(protectedStorage),
    } });
    const tracked = delayedFileSystem(composed, delayed ? 1 : 0);
    const shell = new Shell({ fs: tracked.fs, cwd: '/work' }).use(agentCommands()).use(pythonCommands({ createWorker }));
    context.after(() => shell.dispose());
    await root.writeFile('/work/effects.py', encode(`
import os, errno, tempfile
from pathlib import Path
assert Path('/data/input').read_text() == 'host input'
assert Path('/protected/kept').read_text() == 'host protected'
with open('/data/output', 'w+b') as stream:
 stream.write(b'abcdef'); stream.seek(2); stream.write(b'XY'); stream.seek(0)
 assert stream.read() == b'abXYef'
for mode in ('wb', 'ab', 'r+b'):
 try: open('/protected/kept', mode)
 except OSError as error: assert error.errno == errno.EROFS
 else: raise AssertionError('read-only mutation succeeded')
for mutate in (
 lambda: os.unlink('/protected/kept'),
 lambda: os.rename('/protected/kept', '/protected/renamed'),
 lambda: os.mkdir('/protected/new'),
 lambda: os.rmdir('/protected/empty'),
 lambda: os.truncate('/protected/kept', 0),
):
 try: mutate()
 except OSError as error: assert error.errno == errno.EROFS, repr(error)
 else: raise AssertionError('read-only namespace mutation succeeded')
assert sorted(os.listdir('/protected')) == ['empty', 'kept']
with open('/data/output', 'r+b', buffering=0) as stream:
 os.rename('/data/output', '/data/renamed')
 stream.seek(0); assert stream.read() == b'abXYef'
 stream.seek(6); stream.write(b'!')
assert Path('/data/renamed').read_bytes() == b'abXYef!'
os.rename('/data/renamed', '/data/output')
with open('/data/output', 'r+b', buffering=0) as stream: stream.truncate(6)
try: os.rename('/data/output', '/work/moved')
except OSError as error: assert error.errno == errno.EXDEV
else: raise AssertionError('cross-mount rename succeeded')
assert Path('/data/output').read_bytes() == b'abXYef'
with tempfile.NamedTemporaryFile() as stream:
 stream.write(b'temporary'); stream.flush()
 assert Path(stream.name).read_bytes() == b'temporary'
assert not Path(stream.name).exists()
print('effects passed')
`));
    const first = await shell.exec('python effects.py');
    assert.equal(first.exitCode, 0, first.stderr); assert.equal(first.stdout, 'effects passed\n');
    assert.deepEqual(await writable.readFile('/output'), encode('abXYef'));
    assert.deepEqual(await protectedStorage.readFile('/kept'), encode('host protected'));
    assert.deepEqual(await root.readdir('/tmp'), []);
    await writable.writeFile('/input', encode('host changed'));
    const second = await shell.exec(`python3 -c ${quote("from pathlib import Path; assert Path('/data/input').read_text() == 'host changed'; Path('/data/output').write_bytes(b'reopened')")} ; cat /data/output`);
    assert.equal(second.exitCode, 0, second.stderr); assert.equal(second.stdout, 'reopened');
    assert.deepEqual(await writable.readFile('/output'), encode('reopened'));
    assert.equal(tracked.handles.size, 0); assert.ok(tracked.operations() > 30);
  });
});

test('built public Python quota refusal preserves memory/delayed composed storage and interpreter reuse', { timeout: 30000 }, async t => {
  for (const delay of [0, 1]) await t.test(delay ? 'delayed backend' : 'memory backend', async context => {
    const storage = new MemoryFileSystem(), root = new MemoryFileSystem();
    await storage.writeFile('/kept', encode('original'));
    const quota = withFileSystemQuota(storage, { maxBytes: 8 });
    const tracked = delayedFileSystem(new MountFileSystem({ root, mounts: { '/quota': quota, '/readonly': new ReadOnlyFileSystem(quota) } }), delay);
    const shell = new Shell({ fs: tracked.fs }).use(pythonCommands({ createWorker }));
    context.after(() => shell.dispose());
    const result = await shell.exec('python -c ' + quote(`
import errno
from pathlib import Path
for path, mode, expected in (
 ('/quota/kept', 'rb', errno.ENOTSUP),
 ('/quota/kept', 'wb', errno.ENOTSUP),
 ('/quota/kept', 'ab', errno.ENOTSUP),
 ('/quota/new', 'xb', errno.ENOTSUP),
 ('/readonly/kept', 'wb', errno.EROFS),
):
 try: open(path, mode)
 except OSError as error: assert error.errno == expected, repr(error)
 else: raise AssertionError('unsupported descriptor unexpectedly acquired')
Path('/recovered').write_text('successful')
print('refusals preserved')
`));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, 'refusals preserved\n');
    assert.deepEqual(await storage.readFile('/kept'), encode('original'));
    assert.deepEqual((await storage.readdir('/')).map(entry => entry.name), ['kept']);
    assert.deepEqual(await root.readFile('/recovered'), encode('successful'));
    assert.equal(tracked.handles.size, 0);
  });
});

test('required Python quota mount supports reads, bounded writes and recovery', { timeout: 30000, todo: 'Canonical quota wrapper refuses descriptor open with ENOTSUP; required workflow incomplete' }, async t => {
  const root = new MemoryFileSystem(), storage = new MemoryFileSystem();
  await storage.writeFile('/input', encode('host input'));
  const fs = new MountFileSystem({ root, mounts: { '/quota': withFileSystemQuota(storage, { maxBytes: 32 }) } });
  const shell = new Shell({ fs }).use(pythonCommands({ createWorker }));
  t.after(() => shell.dispose());
  const result = await shell.exec('python -c ' + quote(`
from pathlib import Path
assert Path('/quota/input').read_text() == 'host input'
Path('/quota/output').write_bytes(b'bounded')
try:
 with open('/quota/output', 'ab', buffering=0) as stream: stream.write(b'x' * 64)
except OSError: pass
else: raise AssertionError('quota mutation succeeded')
assert Path('/quota/output').read_bytes() == b'bounded'
Path('/quota/output').write_bytes(b'recovered')
`));
  assert.equal(result.exitCode, 0, 'Required quota workflow remains incomplete:\n' + result.stderr);
  assert.deepEqual(await storage.readFile('/output'), encode('recovered'));
});

test('built public Python setup failure releases capacity for a successful subsequent interpreter', { timeout: 30000 }, async t => {
  let attempts = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ maxConcurrentWorkers: 1,
    createWorker() {
      attempts++;
      return createNodePythonWorker({ trustedPython: true, runtimeModuleURL: attempts === 1
        ? new URL('./missing-runtime.mjs', import.meta.url).href : runtimeModuleURL });
    },
  }));
  t.after(() => shell.dispose());
  const failed = await shell.exec(`python -c 'print("must not execute")'`);
  assert.notEqual(failed.exitCode, 0); assert.ok(failed.stderr.includes('missing-runtime')); assert.equal(failed.stdout, '');
  const success = await shell.exec(`python3 -c 'print(42)'`);
  assert.equal(success.exitCode, 0, success.stderr); assert.equal(success.stdout, '42\n');
});

test('built public Python cancellation and output exhaustion retire descriptors and permit reuse', { timeout: 45000 }, async t => {
  const tracked = delayedFileSystem(new MemoryFileSystem());
  const shell = new Shell({ fs: tracked.fs }).use(pythonCommands({ createWorker, maxConcurrentWorkers: 1 }));
  t.after(() => shell.dispose());
  const controller = new AbortController();
  let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const source = "import os; held=open('/held','wb',buffering=0); held.write(b'persisted'); os.write(1,b'ready');\nwhile True: pass";
  const reason = new Error('qualification cancellation');
  const running = shell.exec('python -c ' + quote(source), { signal: controller.signal,
    stdout: { async write(bytes) { assert.deepEqual(bytes, encode('ready')); reached(); } },
  });
  t.after(async () => { controller.abort(reason); await Promise.allSettled([running]); });
  const rejected = assert.rejects(running, error => error === reason);
  await ready; assert.equal(tracked.handles.size, 1); controller.abort(reason); await rejected;
  assert.equal(tracked.handles.size, 0); assert.deepEqual(await tracked.fs.readFile('/held'), encode('persisted'));
  await assert.rejects(shell.exec(`python -c 'held=open("/exhausted","wb"); print("x" * 10000)'`, { limits: { maxOutputBytes: 16 } }), error => error.limit === 'maxOutputBytes');
  assert.equal(tracked.handles.size, 0);
  const recovered = await shell.exec(`python3 -c 'print("recovered")'`);
  assert.equal(recovered.exitCode, 0, recovered.stderr); assert.equal(recovered.stdout, 'recovered\n');
});

test('built public package offline miss, corrupt local install, integrity failure and subsequent reuse', { timeout: 60000 }, async t => {
  const fs = new MemoryFileSystem(); await fs.mkdir('/work'); await fs.mkdir('/tmp');
  const cache = await createOfflineCache(); let requests = 0;
  const provisioning = { cache, offline: true, transport: async () => { requests++; throw new Error('offline transport invoked'); } };
  const shell = new Shell({ fs, cwd: '/work' }).use(pythonCommands({ createWorker, packageProfile: 'documents', provisioning }));
  t.after(() => shell.dispose());
  await fs.writeFile('/work/broken_fixture-1.0-py3-none-any.whl', encode('not a zip archive'));
  for (const command of ['python -m pip install ./broken_fixture-1.0-py3-none-any.whl', 'python -m pip install safe-bash-unavailable-qualification==1.0']) {
    const result = await shell.exec(command); assert.notEqual(result.exitCode, 0, command); assert.notEqual(result.stderr, '');
  }
  const success = await shell.exec(`python -c 'import docx, openpyxl, xlsxwriter, fpdf, pypdf; pypdf.qualification_state = 42; print("offline ready")'`);
  assert.equal(success.exitCode, 0, success.stderr); assert.equal(success.stdout, 'offline ready\n');
  const fresh = new Shell({ fs, cwd: '/work' }).use(pythonCommands({ createWorker, packageProfile: 'documents', provisioning }));
  t.after(() => fresh.dispose());
  const reused = await fresh.exec(`python3 -c 'import pypdf; assert not hasattr(pypdf,"qualification_state"); print("fresh")'`);
  assert.equal(reused.exitCode, 0, reused.stderr); assert.equal(reused.stdout, 'fresh\n');
  const corrupt = await createOfflineCache();
  const artifact = [...corrupt.entries].find(([key]) => key.includes('-sha256-'));
  assert.ok(artifact); const damaged = artifact[1].slice(); damaged[0] ^= 1; await corrupt.set(artifact[0], damaged);
  const tampered = new Shell({ fs, cwd: '/work' }).use(pythonCommands({ createWorker, packageProfile: 'documents', provisioning: { ...provisioning, cache: corrupt } }));
  t.after(() => tampered.dispose());
  const failure = await tampered.exec(`python -c 'print("must not execute")'`);
  assert.notEqual(failure.exitCode, 0); assert.ok(failure.stderr.toLowerCase().includes('integrity'), failure.stderr); assert.equal(failure.stdout, '');
  const final = await fresh.exec(`python -c 'import pypdf; print("still ready")'`);
  assert.equal(final.exitCode, 0, final.stderr); assert.equal(final.stdout, 'still ready\n'); assert.equal(requests, 0);
});

test('built public package installation cancellation preserves cached environment and retries', { timeout: 45000 }, async t => {
  const cache = await createOfflineCache();
  const before = new Map([...cache.entries].map(([key, bytes]) => [key, bytes.slice()]));
  const controller = new AbortController();
  let reached, release, interrupted = false;
  const ready = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker,
    packageProfile: 'documents', provisioning: { offline: true, cache: {
      async get(key) {
        if (!interrupted && key.includes('-sha256-')) {
          interrupted = true; reached(); await gate;
        }
        return cache.get(key);
      },
      async set(key, bytes) { await cache.set(key, bytes); },
    } },
  }));
  const reason = new Error('qualification package installation cancellation');
  const running = shell.exec(`python -c 'print("must not execute")'`, { signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  t.after(async () => { controller.abort(reason); release(); await Promise.allSettled([running]); await shell.dispose(); });
  await ready; controller.abort(reason); release(); await rejected;
  assert.deepEqual(cache.entries, before, 'aborted setup must not publish an altered environment');
  const success = await shell.exec(`python3 -c 'import docx, pypdf; print("retried installation")'`);
  assert.equal(success.exitCode, 0, success.stderr); assert.equal(success.stdout, 'retried installation\n');
});
