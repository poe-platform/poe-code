import { loadPyodide } from 'pinned-pyodide-loader';
import createPyodideModule from 'pinned-pyodide-module';
import lockFileContents from 'pinned-pyodide-lock';
import trampoline from 'trampoline.wasm';
import nativeCall from 'native-call.wasm';
import statResult from 'stat-result.wasm';
import { MemoryFileSystem, PythonFileSystem, PythonStatTranslator } from '@poe-code/safe-fs/core';
import { createPythonJspiQualificationExecutor } from './python-jspi-executor.fixture.js';

const program = `
import os, sys, zlib, _csv, local_module
assert local_module.answer == 42
assert os.stat('/work/input.bin').st_size == 3
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

export default {
  async fetch(request) {
    const started = performance.now();
    const backend = new MemoryFileSystem();
    await backend.mkdir('/work');
    await backend.writeFile('/work/input.bin', new Uint8Array([0, 255, 42]));
    await backend.writeFile('/work/data.csv', new TextEncoder().encode('a,b\n1,2\n'));
    await backend.writeFile('/work/local_module.py', new TextEncoder().encode('answer = 42'));
    const filesystem = new PythonFileSystem(backend, { cwd: '/work' });
    const metadata = new PythonStatTranslator();
    const stdout = [];
    const stderr = [];
    const requests = [];
    const failures = [];
    const stdin = [255, 0, 42];
    let version;
    let memory;
    let activeRequests = 0;
    let maximumRequests = 0;
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const executor = createPythonJspiQualificationExecutor({ trampoline, nativeCall, statResult, async loadRuntime(configuration) {
      const runtime = await loadPyodide({ indexURL: 'https://safe-python.invalid/', lockFileContents,
        createPyodideModule(settings) {
          const instantiate = settings.instantiateWasm;
          return createPyodideModule({ ...settings, instantiateWasm(imports, receive) {
            configuration.bindImports(imports);
            return instantiate(imports, (instance, module) => {
              configuration.bindInstance(instance);
              receive(instance, module);
            });
          } });
        }, jsglobals: configuration.jsglobals, args: configuration.args, env: configuration.env,
        enableRunUntilComplete: false });
      version = runtime.version;
      memory = runtime._module.HEAPU8.byteLength;
      runtime.globals.set('_record_finalization_failure', message => failures.push(String(message)));
      runtime.runPython('import builtins; builtins._record_finalization_failure = _record_finalization_failure');
      return runtime;
    } });
    try {
      const mode = new URL(request.url).pathname;
      const exitCode = await executor.run({ invocation: { args: ['-c', program + (mode === '/finalization' ? finalization : '')], cwd: '/work', env: {} },
        signal: new AbortController().signal, runtimeMount: '/.runtime', maxTransferBytes: 32, onReady() {},
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
            const value = await filesystem.dispatch(operation);
            return ['stat', 'lstat', 'fstat'].includes(operation.op) ? metadata.translate(value) : value;
          } finally { activeRequests--; }
        } });
      return Response.json({ exitCode, version, memory, stdout, stderr, requests, failures, ticks, maximumRequests,
        output: Array.from(await backend.readFile('/work/output.bin')),
        finalized: await backend.readFile('/work/finalized').then(bytes => Array.from(bytes), () => null),
        buffered: await backend.readFile('/work/buffered').then(bytes => Array.from(bytes), () => null),
        destructor: await backend.readFile('/work/destructor').then(bytes => Array.from(bytes), () => null),
        elapsedMs: performance.now() - started,
        qualification: 'source-native-I/O and finalization; not public executor, background-task retirement, managed Python or deployment qualification' });
    } catch (error) {
      return Response.json({ error: String(error), stack: error.stack, stdout, stderr, requests, failures }, { status: 500 });
    } finally { clearInterval(timer); await executor.terminate(); await filesystem.close(); }
  },
};
