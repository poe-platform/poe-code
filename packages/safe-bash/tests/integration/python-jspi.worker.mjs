import { loadPyodide } from 'pinned-pyodide-loader';
import createPyodideModule from 'pinned-pyodide-module';
import lockFileContents from 'pinned-pyodide-lock';
import trampoline from 'trampoline.wasm';
import nativeCall from 'native-call.wasm';
import statResult from 'stat-result.wasm';
import { createDeviceFileSystem, MemoryFileSystem, PythonFileSystem, PythonStatTranslator } from '@poe-platform/safe-fs/core';
import { createPythonJspiExecutor, pythonCommands, createPythonExecutorPool } from '@poe-platform/safe-bash/commands/python';
import { Shell } from '@poe-platform/safe-bash';
import { observePythonJspiUnhandledErrors } from './python-jspi-errors.mjs';

const unhandledErrors = observePythonJspiUnhandledErrors(globalThis);

async function qualifyShells(backend, createExecutor) {
  const gates = Object.fromEntries(['first', 'sibling'].map(name => {
    let entered, release;
    return [name, {started:new Promise(resolve => { entered = resolve; }), held:new Promise(resolve => { release = resolve; }),
      enter: () => entered(), release: () => release()}];
  }));
  const closed = [];
  const filesystem = new Proxy(backend, {get(target, key) {
    if (key === 'open') return async (path, options) => {
      const handle = await target.open(path, options);
      const name = path.startsWith('/work/held-') ? path.slice('/work/held-'.length) : undefined;
      if (!name || !gates[name]) return handle;
      return new Proxy(handle, {get(retained, property) {
        if (property === 'read') return async (...args) => { gates[name].enter(); await gates[name].held; return retained.read(...args); };
        if (property === 'close') return async () => { closed.push(name); await retained.close(); };
        const value = Reflect.get(retained, property, retained);
        return typeof value === 'function' ? value.bind(retained) : value;
      }});
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  await backend.writeFile('/work/held-first', new Uint8Array([48]));
  await backend.writeFile('/work/held-sibling', new Uint8Array([49]));
  await backend.writeFile('/work/first.py', new TextEncoder().encode("import atexit\natexit.register(_record_finalization_called)\nwith open('/work/held-first', 'rb') as source:\n source.read()\n"));
  await backend.writeFile('/work/sibling.py', new TextEncoder().encode("import sys, types\nsys.modules['sibling_state'] = types.ModuleType('sibling_state')\nwith open('/work/held-sibling', 'rb') as source:\n data = source.read()\nsys.stdout.buffer.write(bytes([255, 0]) + data)\n"));
  await backend.writeFile('/work/fresh.py', new TextEncoder().encode("import sys\nassert 'sibling_state' not in sys.modules\nprint('fresh')\n"));
  let acquisitions = 0;
  const pool = createPythonExecutorPool({maxConcurrentExecutors:2, createExecutor() { acquisitions++; return createExecutor(); }});
  const first = new Shell({fs:filesystem, cwd:'/work'}).use(pythonCommands({createExecutor:pool.createExecutor}));
  const sibling = new Shell({fs:filesystem, cwd:'/work'}).use(pythonCommands({createExecutor:pool.createExecutor}));
  const firstRun = first.exec('python first.py').then(result => ({exitCode:result.exitCode}), error => ({error:String(error)}));
  const siblingRun = sibling.exec('python sibling.py');
  try {
    await Promise.race([
      Promise.all(Object.values(gates).map(gate => gate.started)),
      firstRun.then(result => { throw new Error('first invocation ended before held read: ' + JSON.stringify(result)); }),
      siblingRun.then(result => { throw new Error('sibling invocation ended before held read: ' + JSON.stringify(result)); }),
    ]);
    let disposed = false;
    const disposal = first.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    const waitedForRead = !disposed;
    gates.first.release();
    await disposal;
    const firstResult = await firstRun;
    const borrowed = pool.inspect();
    gates.sibling.release();
    const siblingResult = await siblingRun;
    const fresh = await sibling.exec('python fresh.py');
    return {waitedForRead, borrowed, firstError:firstResult.error, siblingExit:siblingResult.exitCode,
      siblingBytes:Array.from(siblingResult.stdoutBytes), freshExit:fresh.exitCode, fresh:fresh.stdout, closed, acquisitions};
  } finally {
    for (const gate of Object.values(gates)) gate.release();
    await Promise.allSettled([firstRun, siblingRun]);
    await Promise.all([first.dispose(), sibling.dispose()]);
    await pool.dispose();
  }
}

const program = `
import os, stat, sys, zlib, _csv, local_module
assert local_module.answer == 42
assert os.stat('/work/input.bin').st_size == 3
device_stat = os.stat('/dev/null')
assert stat.S_ISCHR(device_stat.st_mode)
assert device_stat.st_mode == 0o020666
assert device_stat.st_uid == device_stat.st_gid == 0
assert device_stat.st_size == 0 and device_stat.st_nlink == 1
assert device_stat.st_atime_ns == device_stat.st_mtime_ns == device_stat.st_ctime_ns == 0
assert os.lstat('/dev/null') == device_stat
assert os.stat('/dev/null') == device_stat
for flags in (os.O_RDONLY, os.O_WRONLY, os.O_RDWR):
 descriptor = os.open('/dev/null', flags)
 try:
  assert os.fstat(descriptor) == device_stat
 finally:
  os.close(descriptor)
directory_stat = os.stat('/dev')
assert stat.S_ISDIR(directory_stat.st_mode)
assert directory_stat.st_mode == 0o040755
assert directory_stat.st_uid == directory_stat.st_gid == 0
assert directory_stat.st_size == 0 and directory_stat.st_nlink == 1
assert directory_stat.st_atime_ns == directory_stat.st_mtime_ns == directory_stat.st_ctime_ns == 0
assert os.lstat('/dev') == directory_stat
assert os.stat('/dev') == directory_stat
assert device_stat.st_dev == directory_stat.st_dev
assert device_stat.st_ino != directory_stat.st_ino
assert device_stat.st_dev != os.stat('/work/input.bin').st_dev
with open('/work/input.bin', 'rb') as source:
 data = source.read()
with open('/work/data.csv', 'r') as source:
 assert list(_csv.reader(source)) == [['a', 'b'], ['1', '2']]
descriptor = os.open('/work/input.bin', os.O_RDONLY)
assert os.lseek(descriptor, 2, os.SEEK_SET) == 2
assert os.read(descriptor, 1) == bytes([42])
os.close(descriptor)
with open('/work/output.bin', 'wb') as output:
 output.write(zlib.decompress(zlib.compress(data)))
assert sys.stdin.buffer.read() == bytes([255, 0, 42])
sys.stdout.buffer.write(data)
sys.stderr.buffer.write(bytes([255, 0]))
try:
 open('/work/absent', 'rb')
except FileNotFoundError as error:
 assert error.errno == 44
else:
 raise AssertionError('missing file did not fail')
`;

const finalization = `
import atexit
buffered = open('/work/buffered', 'wb')
buffered.write(bytes([255, 0, 43]))
class Finalizer:
 def __del__(self, write=open, report=_record_finalization_failure, metadata=os.stat):
  try:
   assert metadata('/work/input.bin').st_size == 3
   with write('/work/destructor', 'wb') as output:
    output.write(bytes([44]))
  except BaseException as error:
   report('destructor: ' + str(error))
finalizer = Finalizer()
def finalize():
 try:
  assert os.stat('/work/input.bin').st_size == 3
  assert 'input.bin' in os.listdir('/work')
  with open('/work/finalized', 'wb') as output:
    output.write(bytes([42]))
  sys.stdout.buffer.write(bytes([45]))
 except BaseException as error:
  _record_finalization_failure('atexit: ' + str(error))
atexit.register(finalize)
`;

const background = `
import asyncio
asyncio.get_event_loop().call_later(0.025, _record_late_callback)
`;

const tasks = `
import asyncio
from pyodide.ffi import run_sync
async def background_task():
 try:
  await asyncio.sleep(3600)
 finally:
  await asyncio.sleep(0)
  with open('/work/task-finalized', 'wb') as output:
   output.write(bytes([46]))
async def generator():
 try:
  yield 42
 finally:
  await asyncio.sleep(0)
  with open('/work/generator-finalized', 'wb') as output:
   output.write(bytes([47]))
task = asyncio.create_task(background_task())
stream = generator()
assert run_sync(stream.__anext__()) == 42
run_sync(asyncio.sleep(0))
`;

const cancelled = `
import atexit
atexit.register(_record_finalization_called)
with open('/work/cancel', 'rb') as source:
 source.read()
`;

export default {
  async fetch(request) {
    const mode = new URL(request.url).pathname;
    if (mode === '/unhandled-errors') {
      await new Promise(resolve => setTimeout(resolve, 0));
      return Response.json(unhandledErrors.snapshot());
    }
    const started = performance.now();
    const backend = new MemoryFileSystem();
    await backend.mkdir('/work');
    await backend.writeFile('/work/input.bin', new Uint8Array([0, 255, 42]));
    await backend.writeFile('/work/data.csv', new TextEncoder().encode('a,b\n1,2\n'));
    await backend.writeFile('/work/local_module.py', new TextEncoder().encode('answer = 42'));
    await backend.writeFile('/work/cancel', new Uint8Array([48]));
    const filesystem = new PythonFileSystem(createDeviceFileSystem(backend), { cwd: '/work' });
    const metadata = new PythonStatTranslator();
    const stdout = [];
    const stderr = [];
    const requests = [];
    const failures = [];
    const callbacks = [];
    const finalizations = [];
    const controller = new AbortController();
    let cancelHandle;
    const stdin = [255, 0, 42];
    let version;
    let memory;
    let retainedProxy;
    let activeRequests = 0;
    let maximumRequests = 0;
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const createExecutor = () => createPythonJspiExecutor({ trampoline, nativeCall, statResult, async loadRuntime(configuration) {
      const runtime = await loadPyodide({ indexURL: 'https://safe-python.invalid/', lockFileContents,
        async createPyodideModule(settings) {
          const instantiate = settings.instantiateWasm;
          const module = await createPyodideModule({ ...settings, instantiateWasm(imports, receive) {
            configuration.bindImports(imports);
            return instantiate(imports, (instance, module) => {
              configuration.bindInstance(instance);
              receive(instance, module);
            });
          } });
          configuration.bindScheduler(module.API);
          return module;
        }, jsglobals: configuration.jsglobals, args: configuration.args, env: configuration.env,
        enableRunUntilComplete: false });
      version = runtime.version;
      memory = runtime._module.HEAPU8.byteLength;
      if (mode === '/proxy') retainedProxy = runtime.globals;
      runtime._api.on_fatal = error => failures.push('fatal: ' + String(error));
      runtime.globals.set('_record_finalization_failure', message => failures.push(String(message)));
      runtime.globals.set('_record_late_callback', () => callbacks.push('late'));
      runtime.globals.set('_record_finalization_called', () => finalizations.push('atexit'));
      runtime.runPython('import builtins; builtins._record_finalization_failure = _record_finalization_failure; builtins._record_late_callback = _record_late_callback; builtins._record_finalization_called = _record_finalization_called');
      if (mode === '/startup-cancel') {
        runtime.runPython('import atexit; atexit.register(_record_finalization_called)');
        controller.abort(new Error('startup cancelled'));
      }
      return runtime;
    } });
    if (mode === '/shell') {
      try { return Response.json({...await qualifyShells(backend, createExecutor), failures, finalizations}); }
      catch (error) { return Response.json({error:String(error), stack:error.stack, failures}, {status:500}); }
      finally { clearInterval(timer); await filesystem.close(); }
    }
    const executor = createExecutor();
    try {
      const exitCode = await executor.run({ invocation: { args: ['-c', program + (mode === '/finalization' ? finalization : mode === '/background' ? background : mode === '/tasks' ? tasks : mode === '/cancel' ? cancelled : '')], cwd: '/work', env: {} },
        signal: controller.signal, runtimeMount: '/.runtime', maxTransferBytes: 32, onReady() {},
        async dispatch(operation) {
          activeRequests++;
          maximumRequests = Math.max(maximumRequests, activeRequests);
          requests.push({ op: operation.op, path: typeof operation.args[0] === 'string' ? operation.args[0] : undefined });
          try {
            await new Promise(resolve => setTimeout(resolve, 1));
            if (operation.op === 'stdout' || operation.op === 'stderr') {
              (operation.op === 'stdout' ? stdout : stderr).push(...operation.args[0]);
              return operation.args[0].length;
            }
            if (operation.op === 'stdin') return stdin.splice(0, operation.args[0]);
            if (operation.op === 'read' && operation.args[0] === cancelHandle) controller.abort(new Error('cancelled'));
            const value = await filesystem.dispatch(operation);
            if (operation.op === 'open' && operation.args[0] === '/work/cancel') cancelHandle = value;
            return ['stat', 'lstat', 'fstat'].includes(operation.op) ? metadata.translate(value) : value;
          } finally { activeRequests--; }
        } });
      if (mode === '/background') await new Promise(resolve => setTimeout(resolve, 50));
      if (mode === '/proxy') {
        try { retainedProxy.destroy(); }
        catch (error) { failures.push('proxy retirement: ' + String(error)); }
      }
      return Response.json({ exitCode, version, memory, stdout, stderr, requests, failures, callbacks, ticks, maximumRequests,
        output: Array.from(await backend.readFile('/work/output.bin')),
        finalized: await backend.readFile('/work/finalized').then(bytes => Array.from(bytes), () => null),
        buffered: await backend.readFile('/work/buffered').then(bytes => Array.from(bytes), () => null),
        destructor: await backend.readFile('/work/destructor').then(bytes => Array.from(bytes), () => null),
        taskFinalized: await backend.readFile('/work/task-finalized').then(bytes => Array.from(bytes), () => null),
        generatorFinalized: await backend.readFile('/work/generator-finalized').then(bytes => Array.from(bytes), () => null),
        elapsedMs: performance.now() - started,
        qualification: 'custom native I/O and lifecycle; not managed Python or deployment qualification' });
    } catch (error) {
      if (mode === '/cancel' || mode === '/startup-cancel') {
        await executor.terminate();
        await new Promise(resolve => setTimeout(resolve, 50));
        return Response.json({error: String(error), finalizations, failures});
      }
      return Response.json({ error: String(error), stack: error.stack, stdout, stderr, requests, failures }, { status: 500 });
    } finally { clearInterval(timer); await executor.terminate(); await filesystem.close(); }
  },
};
