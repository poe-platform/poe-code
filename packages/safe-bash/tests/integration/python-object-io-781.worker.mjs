import { loadPyodide } from 'pinned-pyodide-loader';
import createPyodideModule from 'pinned-pyodide-module';
import lockFileContents from 'pinned-pyodide-lock';
import trampoline from 'trampoline.wasm';
import nativeCall from 'native-call.wasm';
import statResult from 'stat-result.wasm';
import { createDeviceFileSystem, PythonFileSystem, PythonStatTranslator, withObjectFileDescriptors } from '@poe-platform/safe-fs/core';
import { createPythonJspiExecutor } from '@poe-platform/safe-bash/commands/python';
import { ObjectIoMetrics, delayObjectIoBackend, createObjectIoReadbackStream } from '../../../safe-fs/src/testing/object-io-metrics.ts';
import { authorizeObjectIoRequest, cleanupObjectIoBucket } from '../../../safe-fs/src/testing/object-io-control.ts';
import { createObjectFilePublicationConformanceCases } from '@poe-platform/safe-fs/testing/object-publication';
import { createR2StagingFixture } from '../../../safe-fs/tests/integration/object-staging-workerd.fixture.mjs';
import { observePythonJspiUnhandledErrors } from './python-jspi-errors.mjs';

const unhandledErrors = observePythonJspiUnhandledErrors(globalThis);

async function conformance(bucket) {
  const cases = createObjectFilePublicationConformanceCases({ requireStaging: true, createFixture() {
    return { ...createR2StagingFixture(bucket, { chunkBytes: 4, delayed: false, spill: true }), root: '/' };
  } });
  for (const entry of cases) await entry.run();
  return cases.map(entry => entry.name);
}

export async function qualifyPythonObjectIo781(createFixture, { size, chunkBytes, workingPages, delayMs, callerBytes, maxTransferBytes }) {
  const metrics = new ObjectIoMetrics();
  const backend = await createFixture({ metrics, chunkBytes, delayMs });
  const program = `import os, hashlib
block = bytes(range(256)) * ${callerBytes / 256}
_object_io_phase('sequentialWrite')
descriptor = os.open('/output', os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
for index in range(${size / callerBytes}):
 assert os.write(descriptor, block) == len(block)
_object_io_phase('sequentialPublication')
os.close(descriptor)
_object_io_phase('pythonReadback')
def digest_file():
 digest = hashlib.sha256()
 with open('/output', 'rb', buffering=0) as source:
  while data := source.read(${callerBytes}):
   digest.update(data)
 return digest.hexdigest()
print(digest_file())
assert os.stat('/output').st_size == ${size}
assert os.stat('/output').st_mode & 0o777 == 0o600
_object_io_phase('positionedIO')
retained = os.open('/output', os.O_RDONLY)
assert os.pread(retained, 1, 0) == b'\\x00'
descriptor = os.open('/output', os.O_RDWR)
assert os.lseek(descriptor, 17, os.SEEK_SET) == 17
for iteration in range(3):
 for page in range(4):
  position = page * 262144 + 3
  value = bytes([240 + iteration])
  assert os.pwrite(descriptor, value, position) == 1
  assert os.pread(descriptor, 1, position) == value
assert os.lseek(descriptor, 0, os.SEEK_CUR) == 17
_object_io_phase('positionedPublication')
os.close(descriptor)
for page in range(4):
 assert os.pread(retained, 1, page * 262144 + 3) == b'\\x03'
os.close(retained)
_object_io_phase('positionedReadback')
print(digest_file())
_object_io_phase('pythonFinalization')
`;
  await backend.fs.writeFile('/main.py', new TextEncoder().encode(program));
  const filesystem = new PythonFileSystem(createDeviceFileSystem(withObjectFileDescriptors(backend.fs, backend.store, {
    chunkBytes, maxStagedBytes: chunkBytes * workingPages, maxStagedPages: workingPages, maxFileBytes: size,
  })), { cwd: '/', maxTransferBytes });
  const metadata = new PythonStatTranslator();
  let stdout = '';
  let stderr = '';
  let initialWasmMemoryBytes;
  let finalWasmMemoryBytes;
  let runtime;
  const failures = [];
  const executor = createPythonJspiExecutor({ trampoline, nativeCall, statResult, async loadRuntime(configuration) {
    metrics.phase('runtimeStartup');
    runtime = await loadPyodide({ indexURL: 'https://safe-python.invalid/', lockFileContents,
      async createPyodideModule(settings) {
        const instantiate = settings.instantiateWasm;
        const module = await createPyodideModule({ ...settings, instantiateWasm(imports, receive) {
          configuration.bindImports(imports);
          return instantiate(imports, (instance, compiled) => {
            configuration.bindInstance(instance);
            receive(instance, compiled);
          });
        } });
        configuration.bindScheduler(module.API);
        return module;
      }, jsglobals: configuration.jsglobals, args: configuration.args, env: configuration.env, enableRunUntilComplete: false });
    initialWasmMemoryBytes = runtime._module.HEAPU8.byteLength;
    runtime._api.on_fatal = error => failures.push(String(error));
    runtime.globals.set('_object_io_phase', name => metrics.phase(String(name)));
    runtime.runPython('import builtins; builtins._object_io_phase = _object_io_phase');
    metrics.phase('pythonSetup');
    return runtime;
  } });
  let handedOff = false;
  try {
    const exitCode = await executor.run({ invocation: { args: ['/main.py'], cwd: '/', env: {} },
      signal: new AbortController().signal, runtimeMount: '/.runtime', maxTransferBytes, onReady() {},
      dispatch(operation) {
        return metrics.measure('syscall', operation.op, async () => {
          if (operation.op === 'stdout' || operation.op === 'stderr') {
            const text = new TextDecoder().decode(Uint8Array.from(operation.args[0]));
            if (operation.op === 'stdout') stdout += text; else stderr += text;
            return operation.args[0].length;
          }
          if (operation.op === 'stdin') return [];
          const value = await filesystem.dispatch(operation);
          return ['stat', 'lstat', 'fstat'].includes(operation.op) ? metadata.translate(value) : value;
        });
      } });
    finalWasmMemoryBytes = runtime._module.HEAPU8.byteLength;
    metrics.phase('executorRetirement');
    await executor.terminate();
    await filesystem.close();
    metrics.phase('independentReadback');
    const object = await backend.readCanonical('/output');
    if (!object) throw new Error('Canonical object missing');
    const result = { exitCode, stdout, stderr, failures, size, chunkBytes, workingPages, delayMs, callerBytes, maxTransferBytes,
      denominator: { sequentialBytes: size, positionedWrites: 12, positionedWriteBytes: 12, positionedReadBytes: 17 },
      maxResidentPageBytes: chunkBytes * workingPages, initialWasmMemoryBytes, finalWasmMemoryBytes,
      independentReadback: { size: object.size }, events: backend.events };
    const stream = createObjectIoReadbackStream({ body: object.body, size, metrics, dispose: () => backend.dispose(),
      summary: () => ({ ...result, owner: backend.owner, privatePagesAfterCleanup: 0, fixtureObjectsAfterCleanup: 0,
        unhandledWorkerErrors: unhandledErrors.snapshot(),
        qualification: 'workerd delayed R2 fixture, process-local namespace; not authoritative consumer CAS qualification' }) });
    handedOff = true;
    return stream;
  } finally {
    await executor.terminate();
    await filesystem.close();
    if (!handedOff) {
      metrics.phase('fixtureCleanup');
      await backend.dispose();
    }
  }
}

let active = false;
export default { async fetch(request, env) {
  const denied = authorizeObjectIoRequest(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.pathname === '/ready') return Response.json({ ready: true, owner: env.QUALIFICATION_OWNER,
    expiresAt: Number(env.QUALIFICATION_EXPIRES_AT), protocol: 'object-io-781-ndjson-v1', active });
  if (url.pathname === '/unhandled-errors') {
    await new Promise(resolve => setTimeout(resolve, 0));
    return Response.json(unhandledErrors.snapshot());
  }
  if (active) return new Response('Qualification already active in this isolate', { status: 409 });
  active = true;
  let streamHandedOff = false;
  try {
    if (url.pathname === '/cleanup') return Response.json({ owner: env.QUALIFICATION_OWNER,
      expiresAt: Number(env.QUALIFICATION_EXPIRES_AT), ...await cleanupObjectIoBucket(env.SCRATCH) });
    if (url.pathname === '/conformance') return Response.json(await conformance(env.SCRATCH));
    const configuration = Object.fromEntries(['size', 'chunkBytes', 'workingPages', 'delayMs', 'callerBytes', 'maxTransferBytes'].map(name => [name, Number(url.searchParams.get(name))]));
    if (configuration.size !== 9437184 || ![65536, 262144, 1048576].includes(configuration.chunkBytes)
      || ![1, 4, 16].includes(configuration.workingPages) || configuration.chunkBytes * configuration.workingPages > 1048576
      || ![0, 5].includes(configuration.delayMs)
      || ![65536, 262144, 1048576].includes(configuration.callerBytes)
      || ![65536, 262144, 1048576].includes(configuration.maxTransferBytes)
      || [...url.searchParams.keys()].some(name => !(name in configuration) || url.searchParams.getAll(name).length !== 1)) {
      return new Response('Unsupported bounded benchmark configuration', { status: 400 });
    }
    const stream = await qualifyPythonObjectIo781(({ metrics, chunkBytes, delayMs }) => {
      const bucket = delayObjectIoBackend(env.SCRATCH, metrics, delayMs);
      const fixture = createR2StagingFixture(bucket, { chunkBytes, delayed: false, spill: true });
      return { ...fixture, owner: env.QUALIFICATION_OWNER, async dispose() {
        try { await fixture.dispose(); await new Promise(resolve => setTimeout(resolve, 0)); }
        finally { active = false; }
      }, async readCanonical(path) {
        const file = fixture.files.get(path);
        if (!file || file.stat.size !== configuration.size) throw new Error('Canonical size mismatch');
        return bucket.get(file.key);
      } };
    }, configuration);
    streamHandedOff = true;
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
  } catch (error) { return Response.json({ error: String(error), stack: error.stack }, { status: 500 }); }
  finally { if (!streamHandedOff) active = false; }
} };
